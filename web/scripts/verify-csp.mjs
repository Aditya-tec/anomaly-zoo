// Independent check of the injected CSP: every inline script is covered by a
// hash in the page's own <meta> policy, no hash is unused, nothing allows
// 'unsafe-inline'/'unsafe-eval' for scripts, and the policy comes before the
// first script in the document. style-src has no 'unsafe-inline' and no page uses inline styles.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { htmlFiles, inlineScripts } from "./inject-csp.mjs";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", "out");
const problems = [];
let pages = 0;
let totalHashes = 0;

for (const file of htmlFiles(out)) {
  pages++;
  const name = file.slice(out.length + 1);
  const html = readFileSync(file, "utf8");
  const metaMatch = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/i.exec(html);
  if (!metaMatch) { problems.push(`${name}: no CSP <meta>`); continue; }
  const csp = metaMatch[1];
  const scriptSrc = (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src ")) || "").split(/\s+/).slice(1);
  const policyHashes = scriptSrc.filter((t) => t.startsWith("'sha256-"));
  const actual = inlineScripts(html).map((s) => "'sha256-" + createHash("sha256").update(s.text, "utf8").digest("base64") + "'");
  for (const h of actual) if (!policyHashes.includes(h)) problems.push(`${name}: inline script ${h} is NOT allowed by the policy`);
  for (const h of policyHashes) if (!actual.includes(h)) problems.push(`${name}: policy hash ${h} matches no inline script`);
  for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", "data:", "blob:", "*"]) {
    if (scriptSrc.includes(bad)) problems.push(`${name}: script-src contains ${bad}`);
  }
  // style-src: no 'unsafe-inline', and nothing in the page may need it (no <style> block, no style attribute).
  const styleSrc = (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("style-src ")) || "").split(/\s+/).slice(1);
  if (styleSrc.length === 0) problems.push(`${name}: no style-src`);
  for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "*", "data:", "blob:"]) {
    if (styleSrc.includes(bad)) problems.push(`${name}: style-src contains ${bad}`);
  }
  const styleTags = (html.match(/<style/gi) || []).length;
  const styleAttrs = (html.match(/\sstyle\s*=/gi) || []).length;
  if (styleTags) problems.push(`${name}: ${styleTags} inline <style> block(s) would be blocked by style-src`);
  if (styleAttrs) problems.push(`${name}: ${styleAttrs} inline style attribute(s) would be blocked by style-src`);
  if (!csp.includes("default-src 'none'")) problems.push(`${name}: default-src is not 'none'`);
  if (/frame-ancestors/.test(csp)) problems.push(`${name}: frame-ancestors in <meta> is ignored by browsers`);
  const firstScript = html.search(/<script\b/i);
  if (firstScript >= 0 && html.indexOf(metaMatch[0]) > firstScript) problems.push(`${name}: CSP <meta> comes after the first <script>`);
  totalHashes += policyHashes.length;
  console.log(`verify-csp: ${name}: ${actual.length} inline script(s), all covered by ${policyHashes.length} hash(es)`);
}
if (pages === 0) problems.push("no HTML files in out/");
if (problems.length) {
  console.error("CSP verification FAILED:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`verify-csp: OK, ${pages} page(s), ${totalHashes} hash(es)`);