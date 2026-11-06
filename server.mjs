// Zero-dependency dev server: static UI + run API + webhooks + workflow storage.
//   node server.mjs   ->  http://localhost:8787
import http from "node:http";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { runWorkflow } from "./engine/engine.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const WF_DIR = join(ROOT, "workflows");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

const runs = new Map(); // runId -> { id, status, steps, pending, activeEdges }

function startRun(workflow, { trigger, webhookPath } = {}) {
  const run = { id: randomUUID().slice(0, 8), status: "running", steps: [], pending: null, activeEdges: [] };
  runs.set(run.id, run);
  const upsert = (s) => {
    const i = run.steps.findIndex((x) => x.id === s.id);
    if (i >= 0) run.steps[i] = { ...run.steps[i], ...s }; else run.steps.push(s);
  };
  runWorkflow(workflow, {
    trigger, webhookPath,
    hooks: {
      onStep: upsert,
      approve: (req) => new Promise((resolve) => { run.pending = { ...req, resolve }; }),
    },
  }).then((r) => { run.status = r.status; run.activeEdges = r.activeEdges; run.steps = r.steps; })
    .catch((e) => { run.status = "failed"; run.error = String(e.message || e); });
  return run;
}

const view = (run) => ({ id: run.id, status: run.pending ? "waiting" : run.status, error: run.error, steps: run.steps, activeEdges: run.activeEdges,
  pending: run.pending && { nodeId: run.pending.nodeId, message: run.pending.message } });

const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = async (req) => { let s = ""; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workflow";

async function loadAll() {
  await mkdir(WF_DIR, { recursive: true });
  const out = [];
  for (const f of await readdir(WF_DIR)) if (f.endsWith(".json")) out.push(JSON.parse(await readFile(join(WF_DIR, f), "utf8")));
  return out;
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;

    if (p === "/api/workflows" && req.method === "GET") {
      return json(res, 200, (await loadAll()).map(({ id, name }) => ({ id, name })));
    }
    let m;
    if ((m = p.match(/^\/api\/workflows\/([\w-]+)$/))) {
      if (req.method === "GET") return json(res, 200, JSON.parse(await readFile(join(WF_DIR, m[1] + ".json"), "utf8")));
      if (req.method === "PUT") {
        const wf = await readBody(req);
        wf.id = slug(wf.id || wf.name);
        await mkdir(WF_DIR, { recursive: true });
        await writeFile(join(WF_DIR, wf.id + ".json"), JSON.stringify(wf, null, 2));
        return json(res, 200, { id: wf.id });
      }
    }
    if (p === "/api/run" && req.method === "POST") {
      const { workflow, trigger } = await readBody(req);
      return json(res, 200, view(startRun(workflow, { trigger })));
    }
    if ((m = p.match(/^\/api\/run\/(\w+)$/)) && req.method === "GET") {
      const run = runs.get(m[1]);
      return run ? json(res, 200, view(run)) : json(res, 404, { error: "no such run" });
    }
    if ((m = p.match(/^\/api\/run\/(\w+)\/approve$/)) && req.method === "POST") {
      const run = runs.get(m[1]);
      if (!run?.pending) return json(res, 409, { error: "nothing waiting" });
      const { approved } = await readBody(req);
      const { resolve } = run.pending; run.pending = null; resolve(!!approved);
      return json(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/hook\/([\w-]+)$/)) && req.method === "POST") {
      const trigger = await readBody(req);
      const wf = (await loadAll()).find((w) => w.nodes.some((n) => n.type === "trigger.webhook" && n.params?.path === m[1]));
      if (!wf) return json(res, 404, { error: "no workflow for this webhook" });
      return json(res, 202, { runId: startRun(wf, { trigger, webhookPath: m[1] }).id });
    }

    // static
    const rel = p === "/" ? "/web/index.html" : p;
    const file = normalize(join(ROOT, rel));
    if (!file.startsWith(ROOT) || !/^\/(web|engine)\//.test("/" + file.slice(ROOT.length))) { res.writeHead(404); return res.end("not found"); }
    const buf = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(buf);
  } catch (e) {
    if (e.code === "ENOENT") { res.writeHead(404); return res.end("not found"); }
    json(res, 500, { error: String(e.message || e) });
  }
}).listen(PORT, () => console.log(`playground running on http://localhost:${PORT}`));
