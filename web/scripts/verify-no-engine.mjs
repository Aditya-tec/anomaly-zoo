// Spec P6/AC7.2: the WASM engine must not be loadable from / or /anomalies/*.
// Phase P6 pages replay pre-generated traces only. This scans every generated
// HTML file and every script chunk for anything that would fetch the engine.
// (P7 will add /playground and narrow this check to the other routes.)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", "out");
const FORBIDDEN = [/\/engine\//, /\.wasm\b/, /worker\.js/, /client\.mjs/, /WebAssembly\.(instantiate|compile)/, /wasm_exec/];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "engine" && dir === out) continue; // the static engine files themselves are deployed assets, not page code
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(html|js|mjs|css|json|txt|xml)$/.test(name)) yield p;
  }
}

const problems = [];
let scanned = 0;
for (const f of files(out)) {
  if (f.startsWith(join(out, "traces"))) continue; // data files, not code
  scanned++;
  const text = readFileSync(f, "utf8");
  for (const re of FORBIDDEN) {
    const m = re.exec(text);
    if (m) problems.push(`${f.slice(out.length + 1)}: contains ${re} (…${text.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\s+/g, " ")}…)`);
  }
}
if (problems.length) {
  console.error("engine/WASM reference found in page code:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`verify-no-engine: OK, ${scanned} file(s) scanned, none references the engine or WASM`);
