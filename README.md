# Outpulse Flow (playground)

A small Make/n8n-style workflow builder for internal Outpulse products (Niro, Studio, Merlin).
Visual canvas, a node engine, webhooks, and a human-approval step for AI agents.

## Run

```bash
node server.mjs        # http://localhost:8787  (Node 18+, zero dependencies)
ANTHROPIC_API_KEY=sk-... node server.mjs   # real Claude calls; without a key the AI node returns a mock reply
```

## Layout

- `engine/nodes.mjs`: node catalogue (params + run function). Add a node here and it appears in the palette.
- `engine/engine.mjs`: topological runner with `{{ $in.x }}` / `{{ nodeId.x }}` templating and branch ports.
- `server.mjs`: static UI, `/api/run`, approvals, `/api/workflows`, `POST /hook/<path>` webhooks.
- `web/`: canvas UI (pan/zoom, drag nodes, drag from an output port to an input port, Delete removes).
- `workflows/`: saved workflows (JSON). `niro-instagram-post.json` is a demo: trigger, city check, Claude copywriter, human approval, output.

## Notes

- Nodes: manual/webhook triggers, HTTP request, Claude agent, set fields, if/else, delay, human approval, output.
- Webhook example: `curl -X POST localhost:8787/hook/niro-signup -d '{"cafe":"X","city":"Mysuru"}'`
- The HTTP node can call any URL from the server, so keep this tool private until auth is added.
- Planned: Next.js + Supabase + Cloudflare port (engine already runs in Workers-style fetch environments), auth, scheduled triggers, run history in a database.
