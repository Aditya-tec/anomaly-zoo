// Local static server for out/ that applies the headers from vercel.json, so
// the real CSP/caching rules can be exercised without deploying. It also fails
// if two header rules set the same header on one path, because Vercel's
// precedence for overlapping rules is not something to depend on.
//   node scripts/serve.mjs [port]
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "out");
const config = JSON.parse(readFileSync(process.env.SERVE_CONFIG || join(root, "vercel.json"), "utf8"));
const rules = config.headers.map((h) => ({ re: new RegExp("^" + h.source + "$"), headers: h.headers }));
const port = Number(process.argv[2] || 4173);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json", ".wasm": "application/wasm", ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".map": "application/json",
};

export function headersFor(path) {
  const set = new Map();
  for (const r of rules) {
    if (!r.re.test(path)) continue;
    for (const { key, value } of r.headers) {
      if (set.has(key.toLowerCase())) throw new Error(`overlapping header rules both set ${key} on ${path}`);
      set.set(key.toLowerCase(), [key, value]);
    }
  }
  return [...set.values()];
}

function resolveFile(path) {
  const rel = normalize(decodeURIComponent(path)).replace(/^[\\/]+/, "");
  let f = join(out, rel);
  if (!f.startsWith(out + sep) && f !== out) return null;
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
  else if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
  return existsSync(f) && statSync(f).isFile() ? f : null;
}

createServer((req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    const file = resolveFile(path);
    const headers = {};
    for (const [k, v] of headersFor(path)) headers[k] = v;
    if (!file) {\n      const nf = join(out, "404.html");\n      if (existsSync(nf)) { res.writeHead(404, { ...headers, "Content-Type": "text/html; charset=utf-8" }); return res.end(readFileSync(nf)); }\n      res.writeHead(404, { ...headers, "Content-Type": "text/plain" });\n      return res.end("not found");\n    }
    if (!headers["Content-Type"]) headers["Content-Type"] = MIME[extname(file)] || "application/octet-stream";
    res.writeHead(200, headers);
    res.end(readFileSync(file));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(String(e));
  }
}).listen(port, "127.0.0.1", () => console.log(`serving ${out} with vercel.json headers on http://127.0.0.1:${port}/`));