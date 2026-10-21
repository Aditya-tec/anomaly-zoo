// Generates public/og/<slug>.png (1200 x 630, <= 100 KB) by screenshotting the
// /og/<slug> render targets of the built site. Run after `npm run build`:
//   npm run build && npm run og
// Needs Playwright's Chromium (npx playwright install chromium). The PNGs are
// committed: Vercel's build machine has no browser, and the images depend only
// on the manifest and the card design, which og-inputs.mjs fingerprints.
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { ogInputsHash, ogSlugs } from "./og-inputs.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4175;
const LIMIT = 100 * 1024;
const manifest = JSON.parse(readFileSync(join(root, "public", "traces", "manifest.json"), "utf8"));

const server = spawn(process.execPath, [join(root, "scripts", "serve.mjs"), String(PORT)], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((res, rej) => {
  server.stdout.on("data", (d) => String(d).includes("serving") && res());
  server.on("exit", (c) => rej(new Error(`server exited early (${c}); did you run npm run build?`)));
  setTimeout(() => rej(new Error("server did not start")), 20000);
});

const outDir = join(root, "public", "og");
mkdirSync(outDir, { recursive: true });
const inputs = {};
const browser = await chromium.launch();
let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce" });
  const page = await context.newPage();
  for (const slug of ogSlugs(manifest)) {
    await page.goto(`http://127.0.0.1:${PORT}/og/${slug}`, { waitUntil: "load" });
    await page.locator('[data-testid="og-card"]').waitFor();
    await page.evaluate(() => document.fonts.ready);
    const file = join(outDir, `${slug}.png`);
    await page.screenshot({ path: file, type: "png", clip: { x: 0, y: 0, width: 1200, height: 630 }, animations: "disabled" });
    const size = statSync(file).size;
    inputs[slug] = ogInputsHash(root, manifest, slug);
    const ok = size <= LIMIT;
    if (!ok) failed = true;
    console.log(`${ok ? "ok  " : "FAIL"} ${slug}.png ${(size / 1024).toFixed(1)} KB (limit 100 KB)`);
  }
} finally {
  await browser.close();
  server.kill();
}
writeFileSync(join(outDir, "inputs.json"), JSON.stringify(inputs, null, 2) + "\n");
if (failed) process.exit(1);
