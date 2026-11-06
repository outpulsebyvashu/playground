# Outpulse Flow (playground)

A small Make/n8n-style workflow builder for internal Outpulse products (Niro, Studio, Merlin).
Visual canvas, a node engine, webhooks, and a human-approval step for AI agents.

## Run (static, nothing to install)

Open `index.html` in any browser (double-click it, or `firefox index.html`). It is one self-contained file: the engine runs in the browser, workflows save to the browser's localStorage, and the key button stores your Anthropic API key locally (without a key the Claude node returns mock text).
Host it for free by uploading the folder to Cloudflare Pages / GitHub Pages.

After editing anything in `web/` or `engine/`, rebuild the single file with `node build.mjs`.

Optional Node server (`node server.mjs`) adds webhooks (`POST /hook/<path>`) and saves workflows to `workflows/` on disk.

## Layout

- `engine/nodes.mjs`: node catalogue (params + run function). Add a node here and it appears in the palette.
- `engine/engine.mjs`: topological runner with `{{ $in.x }}` / `{{ nodeId.x }}` templating and branch ports.
- `build.mjs`: bundles everything into the static `index.html`.
- `server.mjs`: optional Node server for webhooks and disk storage.
- `web/`: canvas UI (pan/zoom, drag nodes, drag from an output port to an input port, Delete removes).
- `workflows/`: saved workflows (JSON). `niro-instagram-post.json` is a demo: trigger, city check, Claude copywriter, human approval, output.

## Notes

- Nodes: manual/webhook triggers, HTTP request, Claude agent, set fields, if/else, delay, human approval, output.
- Static mode limits: no webhooks; HTTP nodes only reach APIs that allow browser (CORS) requests.
- Webhook example (server mode): `curl -X POST localhost:8787/hook/niro-signup -d '{"cafe":"X","city":"Mysuru"}'`
- The HTTP node can call any URL from the server, so keep this tool private until auth is added.
- Planned: Next.js + Supabase + Cloudflare port (engine already runs in Workers-style fetch environments), auth, scheduled triggers, run history in a database.
