// Checks a DEPLOYED (or locally served) URL using only public GET/HEAD requests:
//   node scripts/check-deployed.mjs https://<host> [--wait 240]
// AC0.3/AC6: every page has a CSP <meta> before its first <script>, every inline
//            script is covered by a hash in it, nothing allows unsafe-inline/eval.
// AC0.4:     caching, content-type and CSP headers on the pages and /engine/*;
//            text responses are compressed.
// --wait N polls up to N seconds until the home page carries the CSP <meta>
// (useful right after a push while the host is still building).
import { createHash } from "node:crypto";
import { inlineScripts } from "./inject-csp.mjs";

const args = process.argv.slice(2);
const base = (args[0] || "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) { console.error("usage: check-deployed.mjs https://host [--wait seconds]"); process.exit(2); }
const waitIdx = args.indexOf("--wait");
const waitSec = waitIdx >= 0 ? Number(args[waitIdx + 1]) : 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SLUGS = ["dirty-read", "non-repeatable-read", "phantom", "lost-update", "read-skew", "write-skew", "read-only-anomaly", "deadlock"];
const PAGES = ["/", "/about", "/playground", ...SLUGS.map((s) => `/anomalies/${s}`)];

const problems = [];
const check = (ok, msg) => { if (!ok) { console.log(`  FAIL  ${msg}`); problems.push(msg); } return ok; };

async function waitForMeta() {
  const deadline = Date.now() + waitSec * 1000;
  for (;;) {
    const html = await (await fetch(base + "/", { cache: "no-store" })).text();
    if (/<meta http-equiv="Content-Security-Policy"/i.test(html) || Date.now() > deadline) return;
    await sleep(10000);
  }
}
await waitForMeta();

// ---- pages: per-page CSP -------------------------------------------------------
let hashesChecked = 0;
for (const path of PAGES) {
  const res = await fetch(base + path, { cache: "no-store" });
  const html = await res.text();
  const before = problems.length;
  check(res.status === 200, `${path}: HTTP ${res.status}`);
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/i.exec(html);
  if (check(!!m, `${path}: CSP <meta> missing`)) {
    const csp = m[1];
    const scriptSrc = (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src ")) || "").split(/\s+/).slice(1);
    const policyHashes = scriptSrc.filter((t) => t.startsWith("'sha256-"));
    const actual = inlineScripts(html).map((s) => "'sha256-" + createHash("sha256").update(s.text, "utf8").digest("base64") + "'");
    check(actual.length > 0, `${path}: no inline scripts found (unexpected for a Next page)`);
    check(actual.every((h) => policyHashes.includes(h)), `${path}: an inline script is not covered by a hash`);
    check(policyHashes.every((h) => actual.includes(h)), `${path}: a policy hash matches no inline script`);
    check(!scriptSrc.some((t) => ["'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", "*", "data:", "blob:"].includes(t)), `${path}: script-src allows something unsafe`);
    const styleSrc = (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("style-src ")) || "").split(/\s+/).slice(1);
    check(styleSrc.length > 0 && !styleSrc.some((t) => ["'unsafe-inline'", "'unsafe-eval'", "*", "data:", "blob:"].includes(t)), `${path}: style-src is missing or allows something unsafe`);
    check(!/\sstyle\s*=/i.test(html) && !/<style\b/i.test(html), `${path}: inline style (attribute or block) in the markup`);
    check(csp.includes("default-src 'none'"), `${path}: default-src is not 'none'`);
    const first = html.search(/<script\b/i);
    check(html.indexOf(m[0]) < (first >= 0 ? first : Infinity), `${path}: CSP <meta> comes after the first <script>`);
    hashesChecked += actual.length;
  }
  console.log(`${problems.length === before ? "PASS" : "FAIL"}  page ${path}`);
}
const notFound = await fetch(base + "/definitely-not-a-page", { cache: "no-store" });
const nfHtml = await notFound.text();
check(notFound.status === 404, `404 page: HTTP ${notFound.status}`);
check(/http-equiv="Content-Security-Policy"/i.test(nfHtml), "404 page: CSP <meta> missing");
console.log(`${notFound.status === 404 ? "PASS" : "FAIL"}  404 page`);

// ---- share images: every page's og:image resolves to a 1200x630 PNG of at most 100 KB ----
for (const path of PAGES) {
  const html = await (await fetch(base + path, { cache: "no-store" })).text();
  const m = /<meta property="og:image" content="([^"]+)"/.exec(html);
  if (!check(!!m, `${path}: no og:image meta`)) continue;
  check(/<meta name="twitter:card" content="summary_large_image"/.test(html), `${path}: no twitter:card`);
  const url = new URL(m[1], base);
  const img = await fetch(base + url.pathname, { cache: "no-store" });
  const bytes = Buffer.from(await img.arrayBuffer());
  const ok = img.status === 200 && /image\/png/.test(img.headers.get("content-type") || "") && bytes.length <= 100 * 1024 && bytes.readUInt32BE(16) === 1200 && bytes.readUInt32BE(20) === 630;
  check(ok, `${path}: og:image ${url.pathname} is not a 1200x630 PNG <= 100 KB (status ${img.status}, ${bytes.length} B)`);
}
const ogPage = await (await fetch(base + "/og/write-skew", { cache: "no-store" })).text();
check(/<meta name="robots" content="noindex/.test(ogPage), "/og/write-skew is not marked noindex");
const sitemap = await (await fetch(base + "/sitemap.xml", { cache: "no-store" })).text();
check(!sitemap.includes("/og/") && sitemap.includes("/playground"), "sitemap lists /playground and no /og/ render target");
console.log("done  share images, noindex render targets, sitemap");

// ---- headers -------------------------------------------------------------------
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
  { path: "/", csp: PAGE_CSP, compressed: true },
  { path: "/anomalies/write-skew", csp: PAGE_CSP, compressed: true },
  { path: "/engine/engine.json", csp: ENGINE_CSP, cache: "no-cache", type: "application/json" },
  { path: "/engine/" + eng.wasm, csp: ENGINE_CSP, cache: "public, max-age=31536000, immutable", type: "application/wasm" },
  { path: "/engine/worker.js", csp: ENGINE_CSP, cache: "public, max-age=0, must-revalidate", type: "text/javascript" },
  { path: "/engine/client.mjs", csp: ENGINE_CSP, cache: "public, max-age=0, must-revalidate", type: "text/javascript" },
  { path: "/engine/wasm_exec.js", csp: ENGINE_CSP, cache: "public, max-age=0, must-revalidate", type: "text/javascript" },
];
const norm = (s) => s.replace(/,\s*/g, ", ").toLowerCase();
for (const t of targets) {
  const before = problems.length;
  const res = await fetch(base + t.path, { method: "GET", headers: { "accept-encoding": "br, gzip" }, cache: "no-store" });
  const h = (k) => res.headers.get(k) || "";
  check(res.status === 200, `${t.path}: HTTP ${res.status}`);
  check(h("content-security-policy") === t.csp, `${t.path}: content-security-policy is "${h("content-security-policy") || "none"}"`);
  for (const [k, v] of Object.entries(GENERIC)) check(h(k) === v, `${t.path}: ${k} is "${h(k) || "none"}", want "${v}"`);
  if (t.cache) check(norm(h("cache-control")) === norm(t.cache), `${t.path}: cache-control is "${h("cache-control") || "none"}", want "${t.cache}"`);
  if (t.type) check(h("content-type").toLowerCase().startsWith(t.type), `${t.path}: content-type is "${h("content-type")}", want ${t.type}`);
  if (t.compressed) check(/br|gzip/.test(h("content-encoding")), `${t.path}: response is not compressed (content-encoding "${h("content-encoding") || "none"}")`);
  console.log(`${problems.length === before ? "PASS" : "FAIL"}  headers ${t.path}`);
}
const home = await fetch(base + "/", { cache: "no-store" });
console.log(`\ninfo: strict-transport-security = ${home.headers.get("strict-transport-security") || "(absent)"}; ${hashesChecked} inline scripts verified across ${PAGES.length} pages`);
console.log(problems.length ? `\nDEPLOYED CHECK: FAIL (${problems.length} problem(s))` : "\nDEPLOYED CHECK: PASS");
process.exit(problems.length ? 1 : 0);
