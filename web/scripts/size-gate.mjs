// Size budgets (spec §3.7, §7.10, §9.6). Run after `npm run build`.
//   - first-load JS on / : <= 150 KB gzip (every script the HTML references)
//   - each trace JSON    : <= 20 KB
//   - matrix.json        : <= 10 KB (the compact summary the home data is built from)
//   - engine WASM        : <= 1.5 MB gzip (CI gate; target 1.0 MB)
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "out");
const KB = 1024;
const gz = (buf) => gzipSync(buf, { level: 9 }).length;
const problems = [];
const line = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) problems.push(msg); };

// `noModule` scripts are Next's legacy polyfills: only browsers without ES-module
// support download them, and the supported browsers (last two versions of
// Chrome, Firefox, Safari, Edge) never do. They are reported but not budgeted.
function scriptsOf(htmlFile) {
  const html = readFileSync(join(out, htmlFile), "utf8");
  const modern = new Set();
  const legacy = new Set();
  for (const m of html.matchAll(/<script\b([^>]*)>/g)) {
    const src = /\ssrc="([^"]+)"/.exec(m[1]);
    if (!src || !src[1].startsWith("/")) continue;
    (/\snomodule\b/i.test(m[1]) ? legacy : modern).add(src[1].split("?")[0]);
  }
  for (const m of html.matchAll(/<link\b([^>]*)>/g)) {
    if (!/rel="preload"/.test(m[1]) || !/as="script"/.test(m[1])) continue;
    const href = /\shref="([^"]+)"/.exec(m[1]);
    if (href && href[1].startsWith("/") && !legacy.has(href[1].split("?")[0])) modern.add(href[1].split("?")[0]);
  }
  return { files: [...modern], legacy: [...legacy], htmlBytes: Buffer.byteLength(html) };
}

function firstLoad(htmlFile) {
  const { files, legacy, htmlBytes } = scriptsOf(htmlFile);
  let total = 0;
  for (const f of files) total += gz(readFileSync(join(out, f)));
  let legacyTotal = 0;
  for (const f of legacy) legacyTotal += gz(readFileSync(join(out, f)));
  return { total, files: files.length, legacyTotal, htmlGz: gz(readFileSync(join(out, htmlFile))), htmlBytes };
}
const home = firstLoad("index.html");
line(home.total <= 150 * KB, `first-load JS on /: ${(home.total / KB).toFixed(1)} KB gzip across ${home.files} script file(s) (budget 150 KB); HTML ${(home.htmlGz / KB).toFixed(1)} KB gzip; legacy noModule polyfills not counted: ${(home.legacyTotal / KB).toFixed(1)} KB`);
for (const page of ["anomalies/write-skew.html", "about.html"]) {
  const r = firstLoad(page);
  console.log(`info  ${page}: scripts ${(r.total / KB).toFixed(1)} KB gzip, HTML ${(r.htmlGz / KB).toFixed(1)} KB gzip (${(r.htmlBytes / KB).toFixed(1)} KB raw, includes the four embedded traces)`);
}

let traces = 0;
let biggest = 0;
for (const f of readdirSync(join(out, "traces"))) {
  if (!/\.(RU|RC|SI|SER)\.json$/.test(f)) continue;
  const size = statSync(join(out, "traces", f)).size;
  traces++;
  biggest = Math.max(biggest, size);
  if (size > 20 * KB) line(false, `${f} is ${size} B (budget 20 KB)`);
}
line(traces === 32 && biggest <= 20 * KB, `${traces} trace files, largest ${(biggest / KB).toFixed(1)} KB (budget 20 KB each)`);

const matrix = statSync(join(out, "traces", "matrix.json")).size;
line(matrix <= 10 * KB, `matrix.json ${matrix} B (budget 10 KB)`);

const engine = JSON.parse(readFileSync(join(out, "engine", "engine.json"), "utf8"));
const wasmPath = join(out, "engine", engine.wasm);
if (existsSync(wasmPath)) {
  const g = gz(readFileSync(wasmPath));
  line(g <= 1_500_000, `engine WASM ${g} B gzip (gate 1,500,000; target 1,000,000)`);
}

if (problems.length) {
  console.error(`\nSIZE GATE: FAIL (${problems.length})`);
  process.exit(1);
}
console.log("\nSIZE GATE: PASS");
