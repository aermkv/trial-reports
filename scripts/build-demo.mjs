// Builds a single self-contained demo page (dist/demo.html): no Supabase, data
// kept in the viewer's browser. Used for the shareable preview only; the real
// app is index.html + src/ served from GitHub Pages.
//   npm i --no-save esbuild && node scripts/build-demo.mjs
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const stub = { name: "no-supabase", setup(b) {
  b.onResolve({ filter: /api-supabase\.js$/ }, () => ({ path: "stub", namespace: "stub" }));
  b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const api = null;", loader: "js" }));
} };
const out = await build({ entryPoints: ["src/app.js"], bundle: true, format: "esm", write: false, minify: true, target: "es2022", plugins: [stub] });
const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const logo = "data:image/svg+xml;base64," + Buffer.from(readFileSync("assets/gardian-black.svg")).toString("base64");
let html = readFileSync("index.html", "utf8")
  .replace(/<link rel="stylesheet" href="https:\/\/use\.typekit\.net[^>]*>\n?/, "")
  .replace('<link rel="stylesheet" href="styles.css" />', `<style>\n${readFileSync("styles.css", "utf8")}\n.no-demo{display:none!important}</style>`)
  .replaceAll('src="assets/gardian-black.svg"', `src="${logo}"`)
  .replace('<title>Trial Reports</title>', '<title>Trial Reports (demo)</title>')
  .replace('<script type="module" src="src/app.js"></script>', `<script>window.TR_DEMO = true;</script>\n<script type="module">\n${js}\n</script>`);
mkdirSync("dist", { recursive: true });
writeFileSync("dist/demo.html", html);
console.log("dist/demo.html", (html.length / 1024).toFixed(0) + " KB");
