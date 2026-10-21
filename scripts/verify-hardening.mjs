// Verifies the repository-level controls of spec §10 that can be checked from
// the files alone. Run from the repository root: node scripts/verify-hardening.mjs
// Each line printed is a control and its result; the exit status is non-zero if any failed.
// Settings that live only on GitHub (branch protection, 2FA, ...) cannot be checked
// here: see docs/REPO-SETTINGS-CHECKLIST.md.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const results = [];
const check = (id, what, ok, detail = "") => results.push({ id, what, ok: Boolean(ok), detail });

// ---- 10.5 GitHub Actions ----
const wfDir = join(root, ".github", "workflows");
const workflows = readdirSync(wfDir).filter((f) => f.endsWith(".yml"));
const unpinned = [];
const noPerms = [];
const dangerous = [];
const injection = [];
const secrets = [];
let usesCount = 0;
for (const f of workflows) {
  const text = read(join(".github", "workflows", f));
  const lines = text.split("\n");
  if (!/^permissions: \{\}\s*$/m.test(text)) noPerms.push(f);
  if (/pull_request_target/.test(text)) dangerous.push(f);
  if (/\$\{\{\s*secrets\./.test(text)) secrets.push(f);
  let runIndent = -1;
  lines.forEach((line, i) => {
    const m = line.match(/^\s*-?\s*uses:\s*(\S+)(.*)$/);
    if (m) {
      usesCount++;
      const [, ref, rest] = m;
      if (!/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(ref) || !/#\s*v?\d/.test(rest)) unpinned.push(`${f}:${i + 1} ${ref}`);
    }
    // Untrusted event data must reach scripts through env, never by ${{ }} interpolation inside run:.
    const indent = line.search(/\S/);
    if (runIndent >= 0 && indent !== -1 && indent <= runIndent) runIndent = -1;
    if (runIndent >= 0 && /\$\{\{/.test(line)) injection.push(`${f}:${i + 1}`);
    const r = line.match(/^(\s*)(?:-\s*)?run:\s*(.*)$/);
    if (r) {
      if (/\$\{\{/.test(r[2])) injection.push(`${f}:${i + 1}`);
      if (r[2] === "|" || r[2] === ">" || r[2] === "|-") runIndent = r[1].length + (line.includes("- run") ? 2 : 0);
    }
  });
}
check("10.5-actions-pinned", `all ${usesCount} 'uses:' are a full 40-hex commit SHA with a version comment`, unpinned.length === 0, unpinned.join("; "));
check("10.5-permissions-default", `every workflow (${workflows.length}) declares top-level permissions: {}`, noPerms.length === 0, noPerms.join(", "));
check("10.5-no-pull-request-target", "no workflow uses pull_request_target", dangerous.length === 0, dangerous.join(", "));
check("10.5-no-secrets", "no workflow reads secrets", secrets.length === 0, secrets.join(", "));
check("10.1-no-run-interpolation", "no ${{ }} expression inside a run: script (no script injection)", injection.length === 0, injection.join("; "));
const writeOnly = [];
for (const f of workflows) {
  const text = read(join(".github", "workflows", f));
  for (const m of text.matchAll(/^\s+(\w[\w-]*):\s*write\s*$/gm)) writeOnly.push(`${f}: ${m[1]}: write`);
}
check("10.5-least-privilege", "the only write permission anywhere is codeql's security-events", writeOnly.every((w) => w === "codeql.yml: security-events: write"), writeOnly.join("; "));

// ---- 10.5 npm ----
const npmrc = read("web/.npmrc");
check("10.5-npmrc", ".npmrc has ignore-scripts=true and save-exact=true", /^ignore-scripts=true$/m.test(npmrc) && /^save-exact=true$/m.test(npmrc));
const pkg = JSON.parse(read("web/package.json"));
const prod = Object.entries(pkg.dependencies ?? {});
check("10.5-prod-deps", `at most 5 production dependencies (${prod.length}: ${prod.map(([n]) => n).join(", ")})`, prod.length <= 5);
const inexact = [...prod, ...Object.entries(pkg.devDependencies ?? {})].filter(([, v]) => !/^\d+\.\d+\.\d+$/.test(v));
check("10.5-exact-versions", "every dependency version in package.json is exact", inexact.length === 0, inexact.map(([n, v]) => `${n}@${v}`).join(", "));
check("10.5-lockfile", "package-lock.json is committed", existsSync(join(root, "web", "package-lock.json")));
const ci = read(".github/workflows/ci.yml");
check("10.5-npm-ci-only", "CI installs with npm ci (never npm install)", /npm ci --ignore-scripts/.test(ci) && !/npm install/.test(ci));
check("10.5-audit-in-ci", "CI runs npm audit --omit=dev --audit-level=high and govulncheck", /npm audit --omit=dev --audit-level=high/.test(ci) && /govulncheck/.test(ci));

// ---- 10.5 Go ----
const gomod = read("go.mod");
check("10.5-go-toolchain-pinned", "go.mod pins a toolchain", /^toolchain go\d/m.test(gomod));
check("10.5-engine-stdlib-only", "the engine module has no dependencies (no require in go.mod)", !/^require\b/m.test(gomod) && !existsSync(join(root, "go.sum")));
check("10.5-pgx-separate-module", "pgx is only in the separate conformance module", /jackc\/pgx/.test(read("conformance/go.mod")));

// ---- 10.5 Dependabot, CodeQL, policy files ----
const dep = read(".github/dependabot.yml");
const eco = (e) => new RegExp(`package-ecosystem: ${e}`).test(dep);
check("10.5-dependabot", "Dependabot covers gomod (root and conformance), npm (web) and github-actions, weekly", eco("gomod") && eco("npm") && eco("github-actions") && /directory: \/conformance/.test(dep) && /directory: \/web/.test(dep) && !/interval: (daily|monthly)/.test(dep));
const cq = existsSync(join(wfDir, "codeql.yml")) ? read(".github/workflows/codeql.yml") : "";
check("10.5-codeql", "CodeQL workflow covers go and javascript-typescript on pull_request and a weekly schedule", /language: go/.test(cq) && /language: javascript-typescript/.test(cq) && /pull_request:/.test(cq) && /schedule:/.test(cq));
for (const f of ["SECURITY.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "CHANGELOG.md", "docs/REPO-SETTINGS-CHECKLIST.md"]) check(`10.5-file-${f}`, `${f} exists`, existsSync(join(root, f)));
check("10.5-security-contents", "SECURITY.md names GitHub private vulnerability reporting, supported versions and a response window", /private vulnerability reporting/i.test(read("SECURITY.md")) && /supported versions/i.test(read("SECURITY.md")) && /\b(\d+|seven|ten|fourteen) (calendar |working )?days\b/i.test(read("SECURITY.md")));
check("10.5-license-mit", "LICENSE is MIT", /^MIT License/m.test(read("LICENSE")));

// ---- 10.2 headers ----
const vj = JSON.parse(read("web/vercel.json"));
const general = vj.headers.find((h) => h.source.startsWith("/(")) ?? vj.headers[0];
const hv = (h, k) => h.headers.find((x) => x.key.toLowerCase() === k.toLowerCase())?.value ?? "";
check("10.2-headers", "general headers: nosniff, no-referrer, Permissions-Policy, COOP same-origin, CSP frame-ancestors 'none'",
  hv(general, "X-Content-Type-Options") === "nosniff" && hv(general, "Referrer-Policy") === "no-referrer" && /camera=\(\)/.test(hv(general, "Permissions-Policy")) &&
    hv(general, "Cross-Origin-Opener-Policy") === "same-origin" && /frame-ancestors 'none'/.test(hv(general, "Content-Security-Policy")));
const hsts = JSON.stringify(vj).toLowerCase().includes("preload");
check("10.2-no-hsts-preload", "no HSTS preload is set", !hsts);

// ---- 10.1 rendering ----
function walk(dir, acc = []) {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === "out") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(tsx?|mjs|js)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
const sources = ["web/app", "web/components", "web/lib"].flatMap((d) => walk(d)).filter((p) => !/\.test\./.test(p));
const banned = /dangerouslySetInnerHTML|\.innerHTML\s*=|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/;
const hits = sources.filter((p) => banned.test(read(p).replace(/\/\/.*$/gm, "")));
check("10.1-no-html-sinks", `no innerHTML-style sink or eval in ${sources.length} web source files`, hits.length === 0, hits.join(", "));
const ext = sources.filter((p) => /https?:\/\/(?!anomaly-zoo\.vercel\.app|github\.com\/Aditya-tec)/.test(read(p).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")));
check("10.1-no-third-party-urls", "no third-party URL in web source (privacy: no third-party requests)", ext.length === 0, ext.join(", "));

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id}: ${r.what}${r.ok || !r.detail ? "" : `  [${r.detail}]`}`);
}
console.log(`${results.length - failed}/${results.length} controls verified`);
process.exit(failed ? 1 : 0);
