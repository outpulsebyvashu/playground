// Node catalogue + runtime. Shared by the server (execution) and the browser (palette / inspector).
// No dependencies: runs on Node 18+ and in modern browsers (run() is only called on the server).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (val && typeof val === "object") {
    return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, render(v, scope)]));
  }
  return val;
}

const parseJSON = (s, fallback) => {
  if (s == null || s === "") return fallback;
  if (typeof s !== "string") return s;
  try { return JSON.parse(s); } catch { throw new Error("Invalid JSON: " + s.slice(0, 60)); }
};

export const NODE_TYPES = {
  "trigger.manual": {
    label: "Manual trigger", group: "Triggers", tone: "blue", icon: "play", outputs: ["out"],
    desc: "Start a run by hand with a JSON payload",
    params: [{ key: "payload", label: "Payload (JSON)", type: "textarea", default: '{\n  "cafe": "Brew Lab",\n  "city": "Mysuru"\n}' }],
    run: async ({ params }) => ({ output: parseJSON(params.payload, {}) }),
  },
  "trigger.webhook": {
    label: "Webhook trigger", group: "Triggers", tone: "blue", icon: "bolt", outputs: ["out"],
    desc: "Starts when POST /hook/<path> is called",
    params: [{ key: "path", label: "Path", type: "text", default: "niro-signup" }],
    run: async ({ trigger }) => ({ output: trigger ?? {} }),
  },
  "http.request": {
    label: "HTTP request", group: "Actions", tone: "dark", icon: "globe", outputs: ["out"],
    desc: "Call any API",
    params: [
      { key: "method", label: "Method", type: "select", options: ["GET", "POST", "PUT", "PATCH", "DELETE"], default: "GET" },
      { key: "url", label: "URL", type: "text", default: "https://httpbin.org/get" },
      { key: "headers", label: "Headers (JSON)", type: "textarea", default: "{}" },
      { key: "body", label: "Body (JSON)", type: "textarea", default: "" },
    ],
    run: async ({ params }) => {
      const method = params.method || "GET";
      const headers = parseJSON(params.headers, {});
      const body = params.body ? (typeof params.body === "string" ? params.body : JSON.stringify(params.body)) : undefined;
      if (body && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
      const res = await fetch(params.url, { method, headers, body: method === "GET" ? undefined : body });
      const text = await res.text();
      let data = text;
      try { data = JSON.parse(text); } catch { /* keep text */ }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return { output: { status: res.status, data } };
    },
  },
  "ai.claude": {
    label: "Claude agent", group: "AI", tone: "violet", icon: "spark", outputs: ["out"],
    desc: "Prompt Claude. Set ANTHROPIC_API_KEY on the server (mock reply if missing)",
    params: [
      { key: "role", label: "Agent role", type: "select", options: ["Strategist", "Copywriter", "Designer", "Growth manager", "Analyst", "Custom"], default: "Copywriter" },
      { key: "system", label: "System prompt", type: "textarea", default: "You are a concise marketing copywriter for Niro, a cafe loyalty app." },
      { key: "prompt", label: "Prompt", type: "textarea", default: "Write one Instagram caption for {{ $in.cafe }} in {{ $in.city }}." },
      { key: "model", label: "Model", type: "text", default: "claude-sonnet-5-5" },
    ],
    run: async ({ params }) => {
      const key = globalThis.process?.env?.ANTHROPIC_API_KEY;
      if (!key) return { output: { text: `[mock ${params.role}] ${String(params.prompt).slice(0, 140)}`, mock: true } };
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: params.model || "claude-sonnet-5-5", max_tokens: 1024,
          system: params.system || undefined,
          messages: [{ role: "user", content: String(params.prompt) }],
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error?.message || `Anthropic ${res.status}`);
      return { output: { text: j.content?.map((c) => c.text ?? "").join("") ?? "", mock: false } };
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
      const { left, right, op } = params;
      const l = left, r = right;
      const ok = {
        "equals": () => String(l) === String(r),
        "not equals": () => String(l) !== String(r),
        "contains": () => String(l).includes(String(r)),
        "greater than": () => Number(l) > Number(r),
        "less than": () => Number(l) < Number(r),
        "exists": () => l !== undefined && l !== null && l !== "",
      }[op]?.() ?? false;
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
