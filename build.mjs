// Bundles web/ + engine/ into ONE self-contained index.html (no server, no modules, works from file:// in any browser).
//   node build.mjs
import { readFileSync, writeFileSync } from "node:fs";
const r = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const strip = (s) => s.replace(/^import .*$/gm, "").replace(/^export default /gm, "const __default = ").replace(/^export /gm, "");
const nodes = strip(r("engine/nodes.mjs")), engine = strip(r("engine/engine.mjs")), demo = strip(r("engine/demo.mjs")), app = strip(r("web/app.js"));
const js = `
const NodesMod = (() => {${nodes}\nreturn { NODE_TYPES, CONNECTION_KINDS, claudeText, registerCustom, unregisterCustom, render, lookup, pickConn }; })();
const DemoMod = (() => {${demo}\nreturn __default; })();
const EngineMod = (() => { const { NODE_TYPES, render } = NodesMod; ${engine}\nreturn { runWorkflow }; })();
(() => { const { NODE_TYPES, CONNECTION_KINDS, claudeText, registerCustom, unregisterCustom } = NodesMod; const { runWorkflow } = EngineMod; const TEMPLATES = DemoMod; ${app}\n})();`;
let html = r("web/index.html")
  .replace('<link rel="stylesheet" href="style.css">', `<style>\n${r("web/style.css")}\n</style>`)
  .replace('<script type="module" src="app.js"></script>', () => `<script>\n${js}\n</script>`);
writeFileSync(new URL("index.html", import.meta.url), html);
console.log("index.html", (html.length / 1024).toFixed(0) + " KB");
