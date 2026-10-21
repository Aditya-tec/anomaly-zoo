// Per-page CSP for a static export (spec §10.3): hash every inline <script>
// and insert a <meta http-equiv="Content-Security-Policy"> as the first child
// of <head>. Directives that browsers ignore in a <meta> element
// (frame-ancestors, report-uri, sandbox) are delivered by response headers.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", "out");

export function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* htmlFiles(p);
    else if (name.endsWith(".html")) yield p;
  }
}

// Inline classic scripts: <script> without src, and not a data block.
export function inlineScripts(html) {
  const found = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
    if (type && /json/i.test(type[1])) continue; // data block, never executed
    found.push({ text: m[2], index: m.index });
  }
  return found;
}

export const hash = (text) => "'sha256-" + createHash("sha256").update(text, "utf8").digest("base64") + "'";

export function policy(hashes) {
  return [
    "default-src 'none'",
    ["script-src 'self'", ...hashes].join(" "),
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");
}

if (process.argv[1] && process.argv[1].endsWith("inject-csp.mjs")) {
  let pages = 0;
  for (const file of htmlFiles(out)) {
    let html = readFileSync(file, "utf8");
    html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/gi, ""); // idempotent
    const hashes = [...new Set(inlineScripts(html).map((s) => hash(s.text)))].sort();
    const meta = `<meta http-equiv="Content-Security-Policy" content="${policy(hashes)}"/>`;
    if (!/<head[^>]*>/i.test(html)) throw new Error(`${file}: no <head>`);
    html = html.replace(/<head([^>]*)>/i, (m0) => m0 + meta);
    writeFileSync(file, html);
    pages++;
    console.log(`inject-csp: ${file.slice(out.length + 1)}: ${hashes.length} inline script hash(es)`);
  }
  if (pages === 0) throw new Error("no HTML files found in out/");
}