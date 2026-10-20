// Checks a DEPLOYED URL for AC0.3 and AC0.4 using only public GET/HEAD requests:
//   node scripts/check-deployed.mjs https://<host> [--wait 240]
// AC0.3: the page has a CSP <meta> before its first <script>, every inline
//        script is covered by a hash in it, nothing allows unsafe-inline/eval.
// AC0.4: caching, content-type and CSP headers on /, /engine/*; exactly one CSP header each.
// --wait N polls for up to N seconds until the deployed page contains the CSP <meta>
// (useful right after a push while Vercel is still building).
import { createHash } from "node:crypto";
import { inlineScripts } from "./inject-csp.mjs";

const args = process.argv.slice(2);
const base = (args[0] || "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) { console.error("usage: check-deployed.mjs https://host [--wait seconds]"); process.exit(2); }
const waitIdx = args.indexOf("--wait");
const waitSec = waitIdx >= 0 ? Number(args[waitIdx + 1]) : 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const problems = [];
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) problems.push(msg); };

async function page() {
  const deadline = Date.now() + waitSec * 1000;
  for (;;) {
    const r = await fetch(base + "/", { cache: "no-store" });
    const html = await r.text();
    if (/<meta http-equiv="Content-Security-Policy"/i.test(html) || Date.now() > deadline) return { r, html };
    await sleep(10000);
  }
}

const { r: pageRes, html } = await page();
console.log(`AC0.3: ${base}/`);
const m = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/i.exec(html);
check(!!m, "CSP <meta> present in the deployed HTML");
if (m) {
  const csp = m[1];
  const scriptSrc = (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src ")) || "").split(/\s+/).slice(1);
  const policyHashes = scriptSrc.filter((t) => t.startsWith("'sha256-"));
  const actual = inlineScripts(html).map((s) => "'sha256-" + createHash("sha256").update(s.text, "utf8").digest("base64") + "'");
  check(actual.length > 0, `page has ${actual.length} inline script(s)`);
  check(actual.every((h) => policyHashes.includes(h)), "every inline script is covered by a hash in the policy");
  check(policyHashes.every((h) => actual.includes(h)), "no policy hash is unused");
  check(!scriptSrc.some((t) => ["'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", "*", "data:", "blob:"].includes(t)), "script-src has no unsafe-inline/unsafe-eval/wasm-unsafe-eval/wildcards");
  check(csp.includes("default-src 'none'"), "default-src 'none'");
  check(html.indexOf(m[0]) < (html.search(/<script\b/i) >= 0 ? html.search(/<script\b/i) : Infinity), "CSP <meta> comes before the first <script>");
}

const GENERIC = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
};
const ENGINE_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'";
const PAGE_CSP = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'none'";

const eng = await (await fetch(base + "/engine/engine.json", { cache: "no-store" })).json();
const targets = [
  { path: "/", csp: PAGE_CSP },
  { path: "/engine/engine.json", csp: ENGINE_CSP, cache: "no-cache", type: "application/json" },
  { path: "/engine/" + eng.wasm, csp: ENGINE_CSP, cache: "public, max-age=31536000, immutable", type: "application/wasm" },
  { path: "/engine/worker.js", csp: ENGINE_CSP, cache: "public, max-age=0, must-revalidate", type: "text/javascript" },
  { path: "/engine/client.mjs", csp: ENGINE_CSP, cache: "public, max-age=0, must-revalidate", type: "text/javascript" },
  { path: "/engine/wasm_exec.js", csp: ENGINE_CSP, cache: "public, max-age=0, must-revalidate", type: "text/javascript" },
];
for (const t of targets) {
  console.log(`AC0.4: ${t.path}`);
  const res = await fetch(base + t.path, { method: "HEAD", cache: "no-store" });
  const h = (k) => res.headers.get(k) || "";
  check(res.status === 200, `HTTP ${res.status}`);
  const cspHeader = h("content-security-policy");
  check(cspHeader === t.csp, `content-security-policy = ${t.csp}` + (cspHeader === t.csp ? "" : ` (got: ${cspHeader || "none"})`));
  for (const [k, v] of Object.entries(GENERIC)) check(h(k) === v, `${k}: ${v}` + (h(k) === v ? "" : ` (got: ${h(k) || "none"})`));
  if (t.cache) {
    const norm = (s) => s.replace(/,\s*/g, ", ").toLowerCase();
    check(norm(h("cache-control")) === norm(t.cache), `cache-control: ${t.cache}` + (norm(h("cache-control")) === norm(t.cache) ? "" : ` (got: ${h("cache-control") || "none"})`));
  }
  if (t.type) check(h("content-type").toLowerCase().startsWith(t.type), `content-type starts with ${t.type} (got: ${h("content-type")})`);
}
console.log("\nrecord for DECISIONS.md (spec §10.2 [VERIFY]): strict-transport-security = " + (pageRes.headers.get("strict-transport-security") || "(absent)"));
console.log(problems.length ? `\nDEPLOYED CHECK: FAIL (${problems.length} problem(s))` : "\nDEPLOYED CHECK: PASS");
process.exit(problems.length ? 1 : 0);
