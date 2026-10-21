// The production URL has one source of truth: SITE_URL in web/lib/site.ts.
//   node scripts/site-url.mjs --check            fail if any document quotes another *.vercel.app URL
//   node scripts/site-url.mjs --set https://x.y  rewrite SITE_URL and every document that quotes the old one
// Not touched, on purpose: spec.md, the dated logs (DECISIONS.md, PROGRESS.md, P0-CHECKLIST.md) and the
// trace JSON Schema's $id (an identifier, never fetched; changing it would change the committed WASM).
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const sitePath = join(root, "web", "lib", "site.ts");
const siteSrc = readFileSync(sitePath, "utf8");
const m = siteSrc.match(/export const SITE_URL = "([^"]+)";/);
if (!m) {
  console.error("SITE_URL not found in web/lib/site.ts");
  process.exit(2);
}
const current = m[1];

const SKIP = new Set(["DECISIONS.md", "PROGRESS.md", "P0-CHECKLIST.md", "COPY-TODO.md", "SECURITY-CONTROLS.md"]);
function docs() {
  const out = [join(root, "README.md"), join(root, "CHANGELOG.md"), join(root, "SECURITY.md")];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(md|txt)$/.test(e) && !SKIP.has(e)) out.push(p);
    }
  };
  walk(join(root, "docs"));
  return out.filter((p) => existsSync(p));
}

// Any URL on a *.vercel.app host quoted in these documents must be the production URL.
const re = /https?:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app\b/gi;

const arg = process.argv[2];
if (arg === "--set") {
  const next = (process.argv[3] || "").replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(next)) {
    console.error("usage: node scripts/site-url.mjs --set https://host.example   (https, no path)");
    process.exit(2);
  }
  writeFileSync(sitePath, siteSrc.replace(current, next));
  let changed = 1;
  for (const p of docs()) {
    const t = readFileSync(p, "utf8");
    const u = t.split(current).join(next);
    if (u !== t) {
      writeFileSync(p, u);
      changed++;
    }
  }
  console.log(`SITE_URL: ${current} -> ${next} (${changed} file(s) changed). Next: cd web && npm run build && npm run og, then commit.`);
} else {
  const bad = [];
  let quoted = 0;
  for (const p of docs()) {
    const t = readFileSync(p, "utf8");
    for (const hit of t.match(re) ?? []) {
      quoted++;
      if (hit.toLowerCase() !== current.toLowerCase()) bad.push(`${p.slice(root.length + 1)}: ${hit}`);
    }
  }
  if (bad.length) {
    console.error(`FAIL: documents quote a URL other than SITE_URL (${current}):\n  ${bad.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`site-url: OK, SITE_URL is ${current}; ${quoted} quotation(s) in documents all agree`);
}
