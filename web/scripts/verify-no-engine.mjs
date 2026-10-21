// Build-time guard for the engine/WASM loading rules (spec §7.10, AC7.2).
//
// Since P7 two places may load the engine, and only after a user action: the
// playground and the "Re-run in your browser" button on anomaly pages. Their
// code reaches the engine through lib/engine.ts, which does a runtime
// `import("/engine/client.mjs")` and `new Worker("/engine/worker.js")`. So:
//   1. No HTML file may mention /engine/ at all (no <link rel=preload>, no <script src>).
//   2. No script may name the WASM file or the Go runtime shim (.wasm, wasm_exec,
//      azoo.<hash>, WebAssembly.instantiate/compile): only the worker may.
//   3. The scripts loaded by `/`, `/about` and the 404 page must not contain the
//      loader either: those pages never have a reason to load the engine.
// Whether a page actually requests the engine before a click is proven at
// runtime by the e2e network assertions.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", "out");
const NEVER_IN_PAGE_CODE = [/\.wasm\b/, /wasm_exec/, /azoo\.[0-9a-f]{8}/, /WebAssembly\.(instantiate|compile)/];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "engine" && dir === out) continue; // the deployed engine files themselves
    if (name === "traces" && dir === out) continue; // data, not code
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(html|js|mjs|css|json|txt|xml)$/.test(name)) yield p;
  }
}

const rel = (f) => f.slice(out.length + 1).replace(/\\/g, "/");
const problems = [];
let scanned = 0;
for (const f of files(out)) {
  scanned++;
  const text = readFileSync(f, "utf8");
  if (f.endsWith(".html") && text.includes("/engine/")) problems.push(`${rel(f)}: an HTML page mentions /engine/`);
  for (const re of NEVER_IN_PAGE_CODE) {
    const m = re.exec(text);
    if (m) problems.push(`${rel(f)}: contains ${re} (…${text.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\s+/g, " ")}…)`);
  }
}

// 3. Entry pages must not load the loader.
const ENTRY = ["index.html", "about.html", "404.html"];
for (const page of ENTRY) {
  const path = join(out, page);
  if (!existsSync(path)) {
    problems.push(`${page}: missing`);
    continue;
  }
  const html = readFileSync(path, "utf8");
  const srcs = new Set([...html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1].split("?")[0]).filter((s) => s.startsWith("/")));
  for (const src of srcs) {
    const code = readFileSync(join(out, src), "utf8");
    if (code.includes("/engine/")) problems.push(`${page} loads ${src}, which contains the engine loader`);
  }
}

if (problems.length) {
  console.error("engine/WASM loading rule broken:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`verify-no-engine: OK, ${scanned} file(s) scanned; no HTML mentions the engine, no script names the WASM, and /, /about and the 404 page carry no loader`);
