// Lighthouse budgets (spec §7.10, §9.6): mobile profile, `/` and one anomaly
// page, three runs each, median score per category.
//   performance >= 0.90, accessibility >= 0.95, best-practices >= 0.95, seo >= 0.95
// Starts scripts/serve.mjs itself (compressed, with the real vercel.json headers),
// launches Chrome with chrome-launcher (CHROME_PATH if set), and exits 1 on a miss.
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;
const URLS = ["/", "/anomalies/write-skew"];
const RUNS = 3;
const BUDGET = { performance: 0.9, accessibility: 0.95, "best-practices": 0.95, seo: 0.95 };

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const server = spawn(process.execPath, [join(root, "scripts", "serve.mjs"), String(PORT)], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((res, rej) => {
  server.stdout.on("data", (d) => String(d).includes("serving") && res());
  server.on("exit", (c) => rej(new Error(`server exited early (${c})`)));
  setTimeout(() => rej(new Error("server did not start")), 20000);
});

const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless=new", "--no-sandbox"], ...(process.env.CHROME_PATH ? { chromePath: process.env.CHROME_PATH } : {}) });
const failures = [];
try {
  for (const path of URLS) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const { lhr } = await lighthouse(BASE + path, { port: chrome.port, output: "json", logLevel: "error", onlyCategories: Object.keys(BUDGET) });
      runs.push(lhr);
    }
    const score = (cat) => median(runs.map((r) => r.categories[cat].score));
    const audit = (id) => median(runs.map((r) => r.audits[id].numericValue));
    console.log(`\n${path}  (median of ${RUNS} runs, mobile profile)`);
    for (const [cat, min] of Object.entries(BUDGET)) {
      const s = score(cat);
      const ok = s >= min;
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${cat.padEnd(15)} ${s.toFixed(2)}  (min ${min})`);
      if (!ok) failures.push(`${path} ${cat} ${s.toFixed(2)} < ${min}`);
    }
    console.log(`  info  FCP ${(audit("first-contentful-paint") / 1000).toFixed(1)} s, LCP ${(audit("largest-contentful-paint") / 1000).toFixed(1)} s, TBT ${Math.round(audit("total-blocking-time"))} ms, CLS ${audit("cumulative-layout-shift").toFixed(3)}, transfer ${Math.round(audit("total-byte-weight") / 1024)} KB`);
    const lcp = audit("largest-contentful-paint");
    if (lcp > 2500) failures.push(`${path} LCP ${(lcp / 1000).toFixed(1)} s > 2.5 s`);
  }
} finally {
  await chrome.kill();
  server.kill();
}
if (failures.length) {
  console.error("\nLIGHTHOUSE: FAIL\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log("\nLIGHTHOUSE: PASS");
