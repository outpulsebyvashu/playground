// Node catalogue + runtime. Shared by the browser (palette / inspector / execution) and the optional Node server.
// No dependencies.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** Resolve "a.b.0.c" against scope. */
export function lookup(path, scope) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), scope);
}

/** Render {{ path }} templates inside strings / objects / arrays. A lone {{x}} keeps its type. */
export function render(val, scope) {
  if (typeof val === "string") {
    const whole = val.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
    if (whole) return lookup(whole[1], scope);
    return val.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, p) => {
      const v = lookup(p, scope);
      return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    });
  }
  if (Array.isArray(val)) return val.map((v) => render(v, scope));
  if (val && typeof val === "object") return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, render(v, scope)]));
  return val;
}

const parseJSON = (s, fallback) => {
  if (s == null || s === "") return fallback;
  if (typeof s !== "string") return s;
  try { return JSON.parse(s); } catch { throw new Error("Invalid JSON: " + s.slice(0, 60)); }
};
const asObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : { result: v });

/* ---------- connections ----------
   A connection is { name, kind, secret, extra } kept by the app (localStorage) and passed in as ctx.connections.
   kinds: anthropic | bearer | header | basic | query | slack | discord | telegram | webhook */
export const CONNECTION_KINDS = {
  anthropic: { label: "Anthropic (Claude)", secret: "API key", extra: null },
  bearer: { label: "Bearer token (HTTP)", secret: "Token", extra: null },
  header: { label: "Custom header (HTTP)", secret: "Header value", extra: "Header name" },
  basic: { label: "Basic auth (HTTP)", secret: "Password", extra: "Username" },
  query: { label: "Query parameter (HTTP)", secret: "Value", extra: "Parameter name" },
  slack: { label: "Slack webhook", secret: "Webhook URL", extra: null },
  discord: { label: "Discord webhook", secret: "Webhook URL", extra: null },
  telegram: { label: "Telegram bot", secret: "Bot token", extra: "Chat ID" },
  webhook: { label: "Generic webhook", secret: "URL", extra: null },
};
export function pickConn(ctx, name, kinds) {
  const list = ctx.connections || [];
  if (name) { const c = list.find((x) => x.name === name); if (!c) throw new Error(`Connection "${name}" not found`); return c; }
  return list.find((x) => kinds.includes(x.kind));
}
function applyAuth(conn, url, headers) {
  if (!conn) return url;
  if (conn.kind === "bearer") headers.authorization = "Bearer " + conn.secret;
  else if (conn.kind === "header") headers[conn.extra || "x-api-key"] = conn.secret;
  else if (conn.kind === "basic") headers.authorization = "Basic " + btoa(`${conn.extra || ""}:${conn.secret}`);
  else if (conn.kind === "query") { const u = new URL(url); u.searchParams.set(conn.extra || "key", conn.secret); return u.toString(); }
  return url;
}

/** Call Claude. Returns text, or null when there is no key (callers fall back to a mock). */
export async function claudeText({ conn, model, system, prompt, maxTokens = 1024 }) {
  const key = conn?.secret ?? globalThis.process?.env?.ANTHROPIC_API_KEY;
  if (!key) return null;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: model || "claude-sonnet-5-5", max_tokens: maxTokens, system: system || undefined, messages: [{ role: "user", content: String(prompt) }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.message || `Anthropic ${res.status}`);
  return (j.content || []).map((c) => c.text ?? "").join("");
}

const NIRO_TEAM = [
  { name: "Strategist", role: "Decide the angle, audience and goal of the campaign for Niro, a cafe loyalty app (Mysuru first, independent cafes)." },
  { name: "Copywriter", role: "Write the caption and hook. Short, warm, no hype. Promise only the 1-month free trial." },
  { name: "Designer", role: "Describe the visual: layout, palette (purple-led with yellow, pink, mint pops), motion. One paragraph." },
  { name: "Growth manager", role: "Pick channel, posting time and one call-to-action. Instagram only for now." },
  { name: "Analyst", role: "Name the 2 metrics to track and what result would count as a win." },
];

export const NODE_TYPES = {
  "trigger.manual": {
    label: "Manual trigger", group: "Triggers", tone: "blue", icon: "play", outputs: ["out"],
    desc: "Start a run by hand with a JSON payload",
    params: [{ key: "payload", label: "Payload (JSON)", type: "textarea", default: '{\n  "cafe": "Brew Lab",\n  "city": "Mysuru"\n}' }],
    run: async ({ params }) => ({ output: parseJSON(params.payload, {}) }),
  },
  "trigger.webhook": {
    label: "Webhook trigger", group: "Triggers", tone: "blue", icon: "bolt", outputs: ["out"],
    desc: "Starts when POST /hook/<path> is called (server mode)",
    params: [{ key: "path", label: "Path", type: "text", default: "niro-signup" }],
    run: async ({ trigger }) => ({ output: trigger ?? {} }),
  },
  "http.request": {
    label: "HTTP request", group: "Actions", tone: "dark", icon: "globe", outputs: ["out"],
    desc: "Call any API, optionally with a saved connection",
    params: [
      { key: "connection", label: "Connection", type: "connection", kinds: ["bearer", "header", "basic", "query"] },
      { key: "method", label: "Method", type: "select", options: ["GET", "POST", "PUT", "PATCH", "DELETE"], default: "GET" },
      { key: "url", label: "URL", type: "text", default: "https://httpbin.org/get" },
      { key: "headers", label: "Headers (JSON)", type: "textarea", default: "{}" },
      { key: "body", label: "Body (JSON)", type: "textarea", default: "" },
    ],
    run: async ({ params, ctx }) => {
      const method = params.method || "GET";
      const headers = { ...parseJSON(params.headers, {}) };
      const conn = params.connection ? pickConn(ctx, params.connection, []) : undefined;
      const url = applyAuth(conn, params.url, headers);
      const body = params.body ? (typeof params.body === "string" ? params.body : JSON.stringify(params.body)) : undefined;
      if (body && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
      const res = await fetch(url, { method, headers, body: method === "GET" ? undefined : body });
      const text = await res.text();
      let data = text; try { data = JSON.parse(text); } catch { /* keep text */ }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return { output: { status: res.status, data } };
    },
  },
  "notify.message": {
    label: "Send message", group: "Actions", tone: "dark", icon: "send", outputs: ["out"],
    desc: "Slack, Discord, Telegram or any webhook",
    params: [
      { key: "connection", label: "Connection", type: "connection", kinds: ["slack", "discord", "telegram", "webhook"] },
      { key: "text", label: "Message", type: "textarea", default: "{{ $in.text }}" },
    ],
    run: async ({ params, ctx }) => {
      const conn = pickConn(ctx, params.connection, ["slack", "discord", "telegram", "webhook"]);
      if (!conn) throw new Error("Add a Slack / Discord / Telegram / webhook connection first");
      const text = String(params.text ?? "");
      let url = conn.secret, body;
      if (conn.kind === "slack") body = { text };
      else if (conn.kind === "discord") body = { content: text.slice(0, 1900) };
      else if (conn.kind === "telegram") { url = `https://api.telegram.org/bot${conn.secret}/sendMessage`; body = { chat_id: conn.extra, text }; }
      else body = { text };
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`${conn.kind} returned ${res.status}`);
      return { output: { sent: true, via: conn.name, text } };
    },
  },
  "ai.claude": {
    label: "Claude agent", group: "AI", tone: "violet", icon: "spark", outputs: ["out"],
    desc: "One agent with a role and prompt (mock reply without a key)",
    params: [
      { key: "connection", label: "Connection", type: "connection", kinds: ["anthropic"] },
      { key: "role", label: "Agent role", type: "select", options: ["Strategist", "Copywriter", "Designer", "Growth manager", "Analyst", "Custom"], default: "Copywriter" },
      { key: "system", label: "System prompt", type: "textarea", default: "You are a concise marketing copywriter for Niro, a cafe loyalty app." },
      { key: "prompt", label: "Prompt", type: "textarea", default: "Write one Instagram caption for {{ $in.cafe }} in {{ $in.city }}." },
      { key: "model", label: "Model", type: "text", default: "claude-sonnet-5-5" },
    ],
    run: async ({ params, ctx }) => {
      const text = await claudeText({ conn: pickConn(ctx, params.connection, ["anthropic"]), model: params.model, system: params.system, prompt: params.prompt });
      return { output: text == null ? { text: `[mock ${params.role}] ${String(params.prompt).slice(0, 140)}`, mock: true } : { text, mock: false } };
    },
  },
  "ai.team": {
    label: "Agent team", group: "AI", tone: "violet", icon: "users", outputs: ["out"],
    desc: "Several agents work on one brief, in a pipeline or in parallel",
    params: [
      { key: "connection", label: "Connection", type: "connection", kinds: ["anthropic"] },
      { key: "brief", label: "Brief", type: "textarea", default: "Plan one Instagram post for {{ $in.cafe }} in {{ $in.city }}." },
      { key: "mode", label: "Mode", type: "select", options: ["pipeline", "parallel"], default: "pipeline" },
      { key: "agents", label: "Agents (JSON list of {name, role})", type: "textarea", default: JSON.stringify(NIRO_TEAM, null, 2) },
      { key: "synthesize", label: "Final summary by a coordinator", type: "select", options: ["yes", "no"], default: "yes" },
      { key: "model", label: "Model", type: "text", default: "claude-sonnet-5-5" },
    ],
    run: async ({ params, ctx }) => {
      const agents = parseJSON(params.agents, []);
      if (!Array.isArray(agents) || !agents.length) throw new Error("Add at least one agent");
      const conn = pickConn(ctx, params.connection, ["anthropic"]);
      const call = async (a, prompt) => {
        const system = `You are the ${a.name} on a small marketing team. ${a.role || ""} Be concise.`;
        const t = await claudeText({ conn, model: params.model, system, prompt });
        return t == null ? `[mock ${a.name}] ${String(params.brief).slice(0, 100)}` : t;
      };
      const results = {};
      if (params.mode === "parallel") {
        await Promise.all(agents.map(async (a) => { results[a.name] = await call(a, params.brief); }));
      } else {
        let notes = "";
        for (const a of agents) {
          results[a.name] = await call(a, `${params.brief}${notes ? "\n\nWork so far from teammates:\n" + notes : ""}`);
          notes += `\n[${a.name}]\n${results[a.name]}\n`;
        }
      }
      let summary = Object.values(results).at(-1);
      if (params.synthesize !== "no") {
        const all = Object.entries(results).map(([k, v]) => `[${k}]\n${v}`).join("\n\n");
        const s = await claudeText({ conn, model: params.model, system: "You are the coordinator. Merge your team's work into one ready-to-approve post: caption, visual note, channel and time, metric.", prompt: `${params.brief}\n\n${all}` });
        summary = s == null ? "[mock coordinator] Combined plan from " + agents.map((a) => a.name).join(", ") : s;
      }
      return { output: { text: summary, results, mode: params.mode } };
    },
  },
  "code.js": {
    label: "Code (JavaScript)", group: "Build", tone: "dark", icon: "code", outputs: ["out"],
    desc: "Write your own step. $in = previous output, $ = other nodes' outputs",
    params: [{ key: "code", label: "JavaScript (async, return an object)", type: "textarea", raw: true, default: "// $in = previous output, $ = outputs by node id\nreturn { ...$in, loud: String($in.cafe || '').toUpperCase() };" }],
    run: async ({ params, input, scope }) => {
      const fn = new AsyncFunction("$in", "$", "fetch", params.code);
      return { output: asObject(await fn(input, scope, (...a) => fetch(...a))) };
    },
  },
  "data.set": {
    label: "Set fields", group: "Data", tone: "blue", icon: "layers", outputs: ["out"],
    desc: "Add or reshape fields with {{ templates }}",
    params: [{ key: "fields", label: "Fields (JSON)", type: "textarea", default: '{\n  "greeting": "Hi {{ $in.cafe }}!"\n}' }],
    run: async ({ params, input }) => ({ output: { ...input, ...parseJSON(params.fields, {}) } }),
  },
  "logic.if": {
    label: "If / else", group: "Logic", tone: "lime", icon: "branch", outputs: ["true", "false"],
    desc: "Branch on a condition",
    params: [
      { key: "left", label: "Value", type: "text", default: "{{ $in.city }}" },
      { key: "op", label: "Operator", type: "select", options: ["equals", "not equals", "contains", "greater than", "less than", "exists"], default: "equals" },
      { key: "right", label: "Compare to", type: "text", default: "Mysuru" },
    ],
    run: async ({ params, input }) => {
      const l = params.left, r = params.right;
      const ok = {
        "equals": () => String(l) === String(r), "not equals": () => String(l) !== String(r),
        "contains": () => String(l).includes(String(r)), "greater than": () => Number(l) > Number(r),
        "less than": () => Number(l) < Number(r), "exists": () => l !== undefined && l !== null && l !== "",
      }[params.op]?.() ?? false;
      return { output: input, port: ok ? "true" : "false" };
    },
  },
  "flow.delay": {
    label: "Delay", group: "Logic", tone: "lime", icon: "clock", outputs: ["out"],
    desc: "Wait before continuing",
    params: [{ key: "ms", label: "Milliseconds", type: "number", default: 1000 }],
    run: async ({ params, input }) => { await sleep(Math.min(Number(params.ms) || 0, 60000)); return { output: input }; },
  },
  "approval.human": {
    label: "Human approval", group: "Logic", tone: "pink", icon: "check", outputs: ["approved", "rejected"],
    desc: "Pause the run until you approve or reject",
    params: [{ key: "message", label: "Message", type: "textarea", default: "Publish this?\n{{ $in.text }}" }],
    run: async ({ params, input, hooks, node }) => {
      const approved = await hooks.approve({ nodeId: node.id, message: String(params.message), data: input });
      return { output: input, port: approved ? "approved" : "rejected" };
    },
  },
  "log.output": {
    label: "Output", group: "Data", tone: "dark", icon: "terminal", outputs: [],
    desc: "Show a final message in the run log",
    params: [{ key: "message", label: "Message", type: "textarea", default: "{{ $in }}" }],
    run: async ({ params }) => ({ output: { message: params.message } }),
  },
};

/* ---------- custom nodes (built by the user) ----------
   def: { type:"custom.slug", label, tone, icon, desc, params:[{key,label,type}], code }  code is async JS with ($in, params, $, fetch) */
export function registerCustom(def) {
  NODE_TYPES[def.type] = {
    label: def.label, group: "Custom", tone: def.tone || "dark", icon: def.icon || "code", outputs: ["out"], custom: true,
    desc: def.desc || "Custom node",
    params: (def.params || []).map((p) => ({ key: p.key, label: p.label || p.key, type: p.type || "text", default: p.default ?? "" })),
    run: async ({ params, input, scope }) => {
      const fn = new AsyncFunction("$in", "params", "$", "fetch", def.code || "return $in;");
      return { output: asObject(await fn(input, params, scope, (...a) => fetch(...a))) };
    },
  };
}
export const unregisterCustom = (type) => { delete NODE_TYPES[type]; };
