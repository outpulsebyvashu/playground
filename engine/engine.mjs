import { NODE_TYPES, render } from "./nodes.mjs";

const now = () => (globalThis.performance ?? Date).now();

/**
 * Run a workflow.
 * wf: { nodes:[{id,type,params}], edges:[{id,from,to,port?}] }
 * opts: { trigger?, webhookPath?, hooks:{ onStep(step), approve({nodeId,message,data}) } }
 * Returns { status: "ok"|"failed", steps:[{id,type,status,output,port,error,ms}] }
 */
export async function runWorkflow(wf, opts = {}) {
  const hooks = { onStep() {}, approve: async () => true, ...(opts.hooks || {}) };
  const nodes = new Map(wf.nodes.map((n) => [n.id, n]));
  const incoming = new Map(wf.nodes.map((n) => [n.id, []]));
  const outgoing = new Map(wf.nodes.map((n) => [n.id, []]));
  for (const e of wf.edges) {
    if (!nodes.has(e.from) || !nodes.has(e.to)) continue;
    incoming.get(e.to).push(e);
    outgoing.get(e.from).push(e);
  }

  // topological order (Kahn). Nodes stuck in cycles never run.
  const indeg = new Map([...incoming].map(([id, es]) => [id, es.length]));
  const queue = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const e of outgoing.get(id)) {
      indeg.set(e.to, indeg.get(e.to) - 1);
      if (indeg.get(e.to) === 0) queue.push(e.to);
    }
  }

  // pick which trigger fires
  const triggers = wf.nodes.filter((n) => n.type.startsWith("trigger."));
  const chosen = opts.webhookPath
    ? triggers.find((n) => n.type === "trigger.webhook" && n.params?.path === opts.webhookPath)
    : triggers.find((n) => n.type === "trigger.manual") ?? triggers[0];
  if (!chosen) throw new Error("Workflow has no trigger node");

  const outputs = {};
  const active = new Set(); // edge ids carrying data
  const steps = [];
  let failed = false;

  for (const id of order) {
    const node = nodes.get(id);
    const def = NODE_TYPES[node.type];
    if (!def) continue;
    const isTrigger = node.type.startsWith("trigger.");
    const ins = incoming.get(id).filter((e) => active.has(e.id));
    if (isTrigger ? node.id !== chosen.id : ins.length === 0) continue;

    const input = ins.length === 0 ? (opts.trigger ?? {}) : Object.assign({}, ...ins.map((e) => outputs[e.from]));
    const scope = { ...outputs, $in: input, $trigger: opts.trigger ?? {} };
    const step = { id, type: node.type, status: "running", ms: 0 };
    steps.push(step);
    hooks.onStep({ ...step });
    const t0 = now();
    try {
      const params = render(node.params ?? {}, scope);
      if (node.type === "approval.human") step.status = "waiting";
      hooks.onStep({ ...step, params });
      const res = await def.run({ node, params, input, trigger: opts.trigger, hooks, scope });
      step.status = "ok";
      step.output = res.output;
      step.port = res.port ?? "out";
      outputs[id] = res.output;
      for (const e of outgoing.get(id)) if ((e.port ?? def.outputs[0] ?? "out") === step.port) active.add(e.id);
    } catch (err) {
      step.status = "error";
      step.error = String(err?.message ?? err);
      failed = true;
    }
    step.ms = Math.round(now() - t0);
    hooks.onStep({ ...step });
    if (failed) break;
  }
  return { status: failed ? "failed" : "ok", steps, activeEdges: [...active] };
}
