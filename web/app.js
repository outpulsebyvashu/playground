import { NODE_TYPES } from "../engine/nodes.mjs";
import { runWorkflow } from "../engine/engine.mjs";
import DEMO from "../engine/demo.mjs";

const $ = (s, el = document) => el.querySelector(s);
const NW = 236, NH = 82;

/* ---------- icons ---------- */
const P = {
  play: '<path d="M7 4.5v15l12-7.5z"/>', bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
  spark: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M6 12h8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  terminal: '<path d="m5 8 4 4-4 4M12 17h7"/>', grid: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>', fit: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/>',
  reset: '<path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>', download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
};
const icon = (n) => `<svg class="i" viewBox="0 0 24 24">${P[n] || ""}</svg>`;
const paintIcons = (root = document) => root.querySelectorAll("[data-i]").forEach((e) => (e.innerHTML = icon(e.dataset.i)));

/* ---------- state ---------- */
let wf = { id: "", name: "Untitled", nodes: [], edges: [] };
let view = { x: 0, y: 0, s: 1 };
let sel = null; // { kind: "node"|"edge", id }
let run = null, pollTimer = null;
const uid = (p) => p + Math.random().toString(36).slice(2, 7);
const def = (n) => NODE_TYPES[n.type];
const nodeById = (id) => wf.nodes.find((n) => n.id === id);
const stepOf = (id) => run?.steps?.find((s) => s.id === id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 1800); }

/* ---------- geometry ---------- */
function outPort(n, port) {
  const outs = def(n).outputs, i = Math.max(0, outs.indexOf(port ?? outs[0]));
  const frac = outs.length === 1 ? 0.5 : (i + 1) / (outs.length + 1);
  return { x: n.x + NW, y: n.y + NH * frac };
}
const inPort = (n) => ({ x: n.x, y: n.y + NH / 2 });
function elbow(x1, y1, x2, y2) {
  if (x2 < x1 + 24) { const o = 40; return `M${x1} ${y1}H${x1 + o}V${(y1 + y2) / 2}H${x2 - o}V${y2}H${x2}`; }
  const mx = (x1 + x2) / 2, dy = y2 - y1;
  if (Math.abs(dy) < 3) return `M${x1} ${y1}H${x2}`;
  const r = Math.min(14, Math.abs(dy) / 2, (x2 - x1) / 2), s = Math.sign(dy);
  return `M${x1} ${y1}H${mx - r}Q${mx} ${y1} ${mx} ${y1 + s * r}V${y2 - s * r}Q${mx} ${y2} ${mx + r} ${y2}H${x2}`;
}

/* ---------- summary text for node subtitle ---------- */
function summary(n) {
  const p = n.params || {};
  switch (n.type) {
    case "trigger.webhook": return `POST /hook/${p.path || ""}`;
    case "http.request": try { return `${p.method} ${new URL(p.url).host}`; } catch { return `${p.method} ${p.url || ""}`; }
    case "ai.claude": return `${p.role || "Agent"} · ${p.model || ""}`;
    case "logic.if": return `${p.left} ${p.op} ${p.right}`;
    case "flow.delay": return `${p.ms || 0} ms`;
    case "approval.human": return "Waits for your decision";
    default: return def(n).desc;
  }
}

/* ---------- render ---------- */
function applyView() {
  $("#world").style.transform = `translate(${view.x}px,${view.y}px) scale(${view.s})`;
  const c = $("#canvas"); c.style.backgroundPosition = `${view.x}px ${view.y}px`; c.style.backgroundSize = `${24 * view.s}px ${24 * view.s}px`;
  $("#zpct").textContent = Math.round(view.s * 100) + "%";
  renderMini();
}

function edgeActive(e) {
  const s = stepOf(e.from), src = nodeById(e.from);
  if (!s || s.status !== "ok" || !src) return false;
  return (e.port ?? def(src).outputs[0]) === s.port;
}

function render() {
  const box = $("#nodes"); box.innerHTML = "";
  for (const n of wf.nodes) {
    const d = def(n); if (!d) continue;
    const st = stepOf(n.id)?.status;
    const el = document.createElement("div");
    el.className = `node${sel?.kind === "node" && sel.id === n.id ? " sel" : ""}${st && st !== "ok" ? " " + st : ""}`;
    el.dataset.id = n.id; el.style.left = n.x + "px"; el.style.top = n.y + "px";
    el.innerHTML = `<div class="badge ${d.tone === "blue" ? "" : d.tone}">${icon(d.icon)}</div>
      <div class="ntext"><div class="ntitle">${esc(n.label || d.label)}</div><div class="nsub">${esc(summary(n))}</div></div><i class="dot ${st || ""}"></i>`;
    if (n.type.startsWith("trigger.") === false) el.insertAdjacentHTML("beforeend", `<span class="port in" data-port="in" style="left:0;top:${NH / 2}px"></span>`);
    d.outputs.forEach((o, i) => {
      const y = NH * (d.outputs.length === 1 ? 0.5 : (i + 1) / (d.outputs.length + 1));
      el.insertAdjacentHTML("beforeend", `<span class="port out" data-port="${o}" style="left:${NW}px;top:${y}px"></span>`);
      if (d.outputs.length > 1) el.insertAdjacentHTML("beforeend", `<span class="plabel ${o === "false" || o === "rejected" ? "alt" : ""}" style="left:${NW}px;top:${y}px">${o}</span>`);
    });
    box.appendChild(el);
  }
  renderEdges(); renderMini(); renderInspector(); renderBottom();
}

function renderEdges() {
  const svg = $("#edges"); let h = "";
  for (const e of wf.edges) {
    const a = nodeById(e.from), b = nodeById(e.to); if (!a || !b) continue;
    const p1 = outPort(a, e.port), p2 = inPort(b), d = elbow(p1.x, p1.y, p2.x, p2.y);
    const on = edgeActive(e), alt = e.port === "false" || e.port === "rejected";
    const isSel = sel?.kind === "edge" && sel.id === e.id;
    h += `<g data-edge="${e.id}"><path class="line${on ? " on" : ""}${alt ? " alt" : ""}${isSel ? " sel" : ""}" d="${d}"/><path class="hit" d="${d}"/>`;
    if (on) { const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2; h += `<g class="chip"><rect x="${mx - 28}" y="${my - 11}" width="56" height="22" rx="11"/><text x="${mx}" y="${my + 4}" text-anchor="middle">1 item</text></g>`; }
    h += "</g>";
  }
  svg.innerHTML = h;
}

function renderMini() {
  const map = $("#map"); if (!wf.nodes.length) { map.innerHTML = ""; return; }
  const xs = wf.nodes.map((n) => n.x), ys = wf.nodes.map((n) => n.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) + NW - x0, h = Math.max(...ys) + NH - y0;
  const W = map.clientWidth || 130, H = map.clientHeight || 70, k = Math.min(W / w, H / h) * 0.9;
  map.innerHTML = wf.nodes.map((n) => `<i style="left:${(n.x - x0) * k + 4}px;top:${(n.y - y0) * k + 4}px;width:${Math.max(NW * k, 4)}px;height:${Math.max(NH * k, 3)}px"></i>`).join("");
}

/* ---------- palette ---------- */
function renderPalette() {
  const q = $("#q").value.toLowerCase(); const groups = {};
  for (const [type, d] of Object.entries(NODE_TYPES)) if (!q || (d.label + d.desc).toLowerCase().includes(q)) (groups[d.group] ??= []).push([type, d]);
  $("#plist").innerHTML = Object.entries(groups).map(([g, items]) => `<div class="group">${g}</div>` + items.map(([t, d]) =>
    `<button class="item" data-add="${t}"><div class="badge ${d.tone === "blue" ? "" : d.tone}">${icon(d.icon)}</div><div><b>${d.label}</b><span>${d.desc}</span></div></button>`).join("")).join("");
}
function addNode(type) {
  const d = NODE_TYPES[type], r = $("#canvas").getBoundingClientRect();
  const cx = (r.width / 2 - view.x) / view.s - NW / 2 + (Math.random() * 60 - 30), cy = (r.height / 2 - view.y) / view.s - NH / 2 + (Math.random() * 60 - 30);
  const params = Object.fromEntries(d.params.map((p) => [p.key, p.default ?? ""]));
  const n = { id: uid(type.split(".")[1].slice(0, 4)), type, x: Math.round(cx / 12) * 12, y: Math.round(cy / 12) * 12, params };
  wf.nodes.push(n); sel = { kind: "node", id: n.id }; render();
}

/* ---------- inspector ---------- */
function renderInspector() {
  const box = $("#inspector");
  if (sel?.kind !== "node") { box.classList.add("hidden"); return; }
  const n = nodeById(sel.id); if (!n) { box.classList.add("hidden"); return; }
  const d = def(n); box.classList.remove("hidden");
  const s = stepOf(n.id);
  box.innerHTML = `<h3>${esc(n.label || d.label)}</h3><div class="sub">${d.label} · id <code>${n.id}</code></div>
    <div class="field"><label>Label</label><input data-k="__label" value="${esc(n.label || "")}" placeholder="${esc(d.label)}"></div>
    ${d.params.map((p) => {
      const v = n.params?.[p.key] ?? p.default ?? "";
      const inner = p.type === "select" ? `<select data-k="${p.key}">${p.options.map((o) => `<option ${o === v ? "selected" : ""}>${o}</option>`).join("")}</select>`
        : p.type === "textarea" ? `<textarea data-k="${p.key}" spellcheck="false">${esc(v)}</textarea>`
        : `<input data-k="${p.key}" type="${p.type === "number" ? "number" : "text"}" value="${esc(v)}">`;
      return `<div class="field"><label>${p.label}</label>${inner}</div>`;
    }).join("")}
    <div class="hint">Use <code>{{ $in.field }}</code> for the previous step, or <code>{{ nodeId.field }}</code>.</div>
    ${s?.output !== undefined ? `<div class="field"><label>Last output</label><pre class="out">${esc(JSON.stringify(s.output, null, 2))}</pre></div>` : ""}
    ${s?.error ? `<div class="field"><label style="color:var(--red)">Error</label><pre class="out">${esc(s.error)}</pre></div>` : ""}
    <div class="row2"><button class="btn sm" id="delNode">${icon("trash")}Delete</button></div>`;
  paintIcons(box);
}
$("#inspector").addEventListener("input", (e) => {
  const k = e.target.dataset.k; if (!k || sel?.kind !== "node") return;
  const n = nodeById(sel.id);
  if (k === "__label") n.label = e.target.value; else (n.params ??= {})[k] = e.target.type === "number" ? Number(e.target.value) : e.target.value;
  const el = $(`.node[data-id="${n.id}"]`); if (el) { $(".ntitle", el).textContent = n.label || def(n).label; $(".nsub", el).textContent = summary(n); }
  $("#inspector h3").textContent = n.label || def(n).label;
});
$("#inspector").addEventListener("click", (e) => { if (e.target.closest("#delNode")) deleteSel(); });

function deleteSel() {
  if (!sel) return;
  if (sel.kind === "node") { wf.nodes = wf.nodes.filter((n) => n.id !== sel.id); wf.edges = wf.edges.filter((e) => e.from !== sel.id && e.to !== sel.id); }
  else wf.edges = wf.edges.filter((e) => e.id !== sel.id);
  sel = null; render();
}

/* ---------- bottom panel ---------- */
function renderBottom() {
  const steps = run?.steps || [];
  if (!steps.length) {
    $("#bars").innerHTML = '<div class="empty">Run the workflow to see step timings</div>'; $("#bars-x").innerHTML = "";
    $("#tbl").innerHTML = '<div class="empty" style="height:100%;display:flex;align-items:center;justify-content:center">No runs yet</div>'; return;
  }
  const max = Math.max(20, ...steps.map((s) => s.ms || 0));
  $("#bars").innerHTML = steps.map((s) => `<div class="col"><div class="bar ${s.status === "ok" ? "" : s.status}" style="height:${Math.max(4, ((s.ms || 0) / max) * 82)}%"><span>${s.ms || 0}ms</span></div></div>`).join("");
  $("#bars-x").innerHTML = steps.map((s) => `<div>${esc(nodeById(s.id)?.label || def(nodeById(s.id) || {})?.label || s.id)}</div>`).join("");
  $("#tbl").innerHTML = `<table><thead><tr><th>Step</th><th>Type</th><th>Status</th><th>Time</th></tr></thead><tbody>${steps.map((s) => {
    const n = nodeById(s.id);
    return `<tr class="r" data-node="${s.id}"><td>${esc(n?.label || def(n || {})?.label || s.id)}</td><td style="color:var(--ink3)">${s.type}</td><td><span class="tag ${s.status}">${s.status}</span></td><td>${s.ms || 0} ms</td></tr>`;
  }).join("")}</tbody></table>`;
}
$("#tbl").addEventListener("click", (e) => { const r = e.target.closest("tr[data-node]"); if (r) { sel = { kind: "node", id: r.dataset.node }; render(); } });

/* ---------- run ---------- */
function setStatus(s) { const el = $("#status"); el.className = "status " + s; el.textContent = { idle: "Idle", running: "Running…", waiting: "Waiting for approval", ok: "Run complete", failed: "Run failed" }[s] || s; }
/* static mode: everything runs in the browser; workflows live in localStorage */
const LS = "outpulse-flow:workflows", store = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } };
const allWf = () => ({ [DEMO.id]: DEMO, ...store() });
const localRuns = {};
function localRun(workflow) {
  const r = { id: uid("r"), status: "running", steps: [], pending: null, activeEdges: [] }; localRuns[r.id] = r;
  runWorkflow(workflow, { hooks: {
    onStep: (s) => { const i = r.steps.findIndex((x) => x.id === s.id); if (i >= 0) r.steps[i] = { ...r.steps[i], ...s }; else r.steps.push(s); },
    approve: (req) => new Promise((resolve) => { r.pending = { ...req, resolve }; }),
  } }).then((o) => { r.status = o.status; r.steps = o.steps; r.activeEdges = o.activeEdges; }).catch((e) => { r.status = "failed"; r.error = String(e.message || e); });
  return r;
}
const runView = (r) => ({ id: r.id, status: r.pending ? "waiting" : r.status, error: r.error, steps: r.steps, activeEdges: r.activeEdges, pending: r.pending && { nodeId: r.pending.nodeId, message: r.pending.message } });
async function api(path, opts) {
  let m; const body = opts?.body;
  if (path === "/api/workflows") return Object.values(allWf()).map(({ id, name }) => ({ id, name }));
  if ((m = path.match(/^\/api\/workflows\/([\w-]+)$/))) {
    if (opts?.method === "PUT") { const id = (body.id || body.name || "workflow").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workflow"; localStorage.setItem(LS, JSON.stringify({ ...store(), [id]: { ...body, id } })); return { id }; }
    return structuredClone(allWf()[m[1]]);
  }
  if (path === "/api/run") return runView(localRun(body.workflow));
  if ((m = path.match(/^\/api\/run\/(\w+)\/approve$/))) { const r = localRuns[m[1]]; const { resolve } = r.pending; r.pending = null; resolve(!!body.approved); return { ok: true }; }
  if ((m = path.match(/^\/api\/run\/(\w+)$/))) return runView(localRuns[m[1]]);
  throw new Error("unknown route " + path);
}

async function startRun() {
  clearInterval(pollTimer); run = { steps: [] }; setStatus("running"); $("#runBtn").disabled = true; render();
  try { run = await api("/api/run", { method: "POST", body: { workflow: wf } }); } catch (e) { toast("Run failed: " + e.message); $("#runBtn").disabled = false; setStatus("failed"); return; }
  pollTimer = setInterval(poll, 350); poll();
}
async function poll() {
  try { run = await api("/api/run/" + run.id); } catch { return; }
  setStatus(run.status); render();
  const ap = $("#approval");
  if (run.pending) { $("#apmsg").textContent = run.pending.message; ap.classList.remove("hidden"); } else ap.classList.add("hidden");
  if (run.status === "ok" || run.status === "failed") { clearInterval(pollTimer); $("#runBtn").disabled = false; if (run.error) toast(run.error); }
}
const decide = (approved) => api(`/api/run/${run.id}/approve`, { method: "POST", body: { approved } }).then(poll);
$("#app").onclick = () => decide(true); $("#rej").onclick = () => decide(false);
$("#runBtn").onclick = startRun;
$("#clearBtn").onclick = () => { clearInterval(pollTimer); run = null; $("#approval").classList.add("hidden"); $("#runBtn").disabled = false; setStatus("idle"); render(); };

/* ---------- save / load ---------- */
$("#wfname").oninput = (e) => (wf.name = e.target.value);
$("#saveBtn").onclick = async () => { try { wf.id = (await api("/api/workflows/" + (wf.id || "new"), { method: "PUT", body: wf })).id; toast("Saved " + wf.id + ".json"); } catch (e) { toast("Save failed: " + e.message); } };
$("#loadBtn").onclick = async () => {
  const m = $("#loadmenu"); if (!m.classList.contains("hidden")) return m.classList.add("hidden");
  const list = await api("/api/workflows");
  m.innerHTML = list.map((w) => `<button data-wf="${w.id}">${esc(w.name)}</button>`).join("") + `<button data-wf="">＋ New workflow</button>`;
  m.classList.remove("hidden");
};
$("#loadmenu").onclick = async (e) => {
  const b = e.target.closest("button"); if (!b) return; $("#loadmenu").classList.add("hidden");
  setWorkflow(b.dataset.wf ? await api("/api/workflows/" + b.dataset.wf) : { id: "", name: "Untitled", nodes: [{ id: "start", type: "trigger.manual", x: 80, y: 160, params: { payload: "{}" } }], edges: [] });
};
function setWorkflow(w) { wf = w; run = null; sel = null; $("#wfname").value = wf.name; $("#approval").classList.add("hidden"); setStatus("idle"); render(); fit(); }

/* ---------- canvas interaction ---------- */
const canvas = $("#canvas");
const toWorld = (cx, cy) => { const r = canvas.getBoundingClientRect(); return { x: (cx - r.left - view.x) / view.s, y: (cy - r.top - view.y) / view.s }; };
let drag = null;

canvas.addEventListener("pointerdown", (e) => {
  const port = e.target.closest(".port.out"), nodeEl = e.target.closest(".node"), edgeEl = e.target.closest("[data-edge]");
  canvas.setPointerCapture(e.pointerId);
  if (port) {
    const n = nodeById(nodeEl.dataset.id); drag = { kind: "connect", from: n.id, port: port.dataset.port };
  } else if (nodeEl) {
    const n = nodeById(nodeEl.dataset.id), w = toWorld(e.clientX, e.clientY);
    sel = { kind: "node", id: n.id }; drag = { kind: "node", n, dx: w.x - n.x, dy: w.y - n.y, moved: false };
    document.querySelectorAll(".node.sel").forEach((x) => x.classList.remove("sel")); nodeEl.classList.add("sel"); renderInspector();
  } else if (edgeEl) {
    sel = { kind: "edge", id: edgeEl.dataset.edge }; renderEdges(); renderInspector();
  } else {
    sel = null; drag = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; canvas.classList.add("panning");
    document.querySelectorAll(".node.sel").forEach((x) => x.classList.remove("sel")); renderEdges(); renderInspector();
  }
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  if (drag.kind === "pan") { view.x = drag.vx + e.clientX - drag.sx; view.y = drag.vy + e.clientY - drag.sy; applyView(); }
  else if (drag.kind === "node") {
    const w = toWorld(e.clientX, e.clientY); drag.n.x = Math.round((w.x - drag.dx) / 6) * 6; drag.n.y = Math.round((w.y - drag.dy) / 6) * 6; drag.moved = true;
    const el = $(`.node[data-id="${drag.n.id}"]`); el.style.left = drag.n.x + "px"; el.style.top = drag.n.y + "px"; renderEdges(); renderMini();
  } else if (drag.kind === "connect") {
    const a = nodeById(drag.from), p1 = outPort(a, drag.port), w = toWorld(e.clientX, e.clientY);
    renderEdges(); $("#edges").insertAdjacentHTML("beforeend", `<path class="line on" d="${elbow(p1.x, p1.y, w.x, w.y)}" style="fill:none;stroke:#2457ff;stroke-width:2;stroke-dasharray:5 4"/>`);
  }
});
canvas.addEventListener("pointerup", (e) => {
  if (drag?.kind === "connect") {
    const tgt = document.elementFromPoint(e.clientX, e.clientY)?.closest(".node");
    const to = tgt && nodeById(tgt.dataset.id);
    if (to && to.id !== drag.from && !to.type.startsWith("trigger.") && !wf.edges.some((x) => x.from === drag.from && x.to === to.id && (x.port ?? "out") === drag.port)) {
      wf.edges.push({ id: uid("e"), from: drag.from, to: to.id, ...(def(nodeById(drag.from)).outputs.length > 1 ? { port: drag.port } : {}) });
    } else if (tgt) toast("Can't connect there");
    renderEdges();
  }
  if (drag?.kind === "node" && !drag.moved) renderInspector();
  drag = null; canvas.classList.remove("panning");
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault(); const r = canvas.getBoundingClientRect(), f = Math.exp(-e.deltaY * 0.0015), ns = Math.min(2, Math.max(0.3, view.s * f));
  const mx = e.clientX - r.left, my = e.clientY - r.top; view.x = mx - ((mx - view.x) / view.s) * ns; view.y = my - ((my - view.y) / view.s) * ns; view.s = ns; applyView();
}, { passive: false });
document.addEventListener("keydown", (e) => { if ((e.key === "Delete" || e.key === "Backspace") && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) deleteSel(); });

function zoomBy(f) { const r = canvas.getBoundingClientRect(), ns = Math.min(2, Math.max(0.3, view.s * f)), mx = r.width / 2, my = r.height / 2; view.x = mx - ((mx - view.x) / view.s) * ns; view.y = my - ((my - view.y) / view.s) * ns; view.s = ns; applyView(); }
$("#zin").onclick = () => zoomBy(1.2); $("#zout").onclick = () => zoomBy(1 / 1.2);
function fit() {
  if (!wf.nodes.length) { view = { x: 0, y: 0, s: 1 }; return applyView(); }
  const r = canvas.getBoundingClientRect(), wide = r.width > 900;
  const left = wide ? ($("#palette").classList.contains("hidden") ? 100 : 360) : 20, right = wide ? 30 : 20, top = 110;
  const bot = $("#bottom").classList.contains("hidden") ? 40 : wide ? 270 : 220;
  const x0 = Math.min(...wf.nodes.map((n) => n.x)), y0 = Math.min(...wf.nodes.map((n) => n.y));
  const x1 = Math.max(...wf.nodes.map((n) => n.x + NW)), y1 = Math.max(...wf.nodes.map((n) => n.y + NH));
  const s = Math.min(1.1, Math.max(0.3, Math.min((r.width - left - right) / (x1 - x0 + 40), (r.height - top - bot) / (y1 - y0 + 40))));
  view = { s, x: left + (r.width - left - right - (x1 - x0) * s) / 2 - x0 * s, y: top + (r.height - top - bot - (y1 - y0) * s) / 2 - y0 * s }; applyView();
}
$("#fitBtn").onclick = fit;
globalThis.ANTHROPIC_KEY = localStorage.getItem("outpulse-flow:key") || "";
$("#keyBtn").onclick = () => { const k = prompt("Anthropic API key (stored only in this browser). Leave empty to use mock replies.", globalThis.ANTHROPIC_KEY || ""); if (k === null) return; globalThis.ANTHROPIC_KEY = k.trim(); localStorage.setItem("outpulse-flow:key", globalThis.ANTHROPIC_KEY); toast(k.trim() ? "Key saved in this browser" : "Using mock replies"); };

/* ---------- chrome ---------- */
document.querySelectorAll("#rail [data-panel]").forEach((b) => (b.onclick = () => { const p = $("#" + b.dataset.panel); p.classList.toggle("hidden"); b.classList.toggle("on", !p.classList.contains("hidden")); }));
$("#palette").classList.add("hidden"); $('#rail [data-panel="palette"]').classList.remove("on"); // palette starts closed so the canvas gets the room
$("#plist").onclick = (e) => { const b = e.target.closest("[data-add]"); if (b) { addNode(b.dataset.add); if (innerWidth < 900) $("#palette").classList.add("hidden"); } };
$("#q").oninput = renderPalette;
addEventListener("resize", () => { renderMini(); });

/* ---------- boot ---------- */
paintIcons(); renderPalette();
if (innerWidth < 900) { $("#bottom").classList.add("hidden"); $("#palette").classList.add("hidden"); document.querySelectorAll("#rail [data-panel]").forEach((b) => b.classList.remove("on")); }
(async () => {
  try { const list = await api("/api/workflows"); setWorkflow(list.length ? await api("/api/workflows/" + list[0].id) : { id: "", name: "Untitled", nodes: [{ id: "start", type: "trigger.manual", x: 80, y: 160, params: { payload: "{}" } }], edges: [] }); }
  catch (e) { toast("Could not load workflows: " + e.message); }
})();
