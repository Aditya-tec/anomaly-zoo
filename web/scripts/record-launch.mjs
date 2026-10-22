// Records the launch clip (spec 13.1 item 1) by driving the REAL built site with Playwright:
// write skew at Snapshot Isolation (zero on call) -> flip to Serializable -> T2 aborts -> the
// invariant holds. Nothing is faked: every frame is the site responding to real clicks.
//
// Captions are an overlay that THIS script injects into the page it records. The site itself has no
// such code. The recording context uses bypassCSP so the overlay's inline style is allowed; the site's
// strict CSP is tested elsewhere (e2e/csp.spec.ts) and is not what is being filmed here.
//
// Run from web/ after `npm run build` (needs ffmpeg for the MP4 and GIF):
//   node scripts/record-launch.mjs            writes ../docs/launch/hero.mp4 and hero.gif
//   node scripts/record-launch.mjs --raw-only writes only the raw .webm (no ffmpeg needed)
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const PORT = 4175;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = resolve(process.cwd(), "..", "docs", "launch");
const RAW_ONLY = process.argv.includes("--raw-only");
mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "azoo-rec-"));

const server = spawn(process.execPath, ["scripts/serve.mjs", String(PORT)], { stdio: "ignore" });
const stop = () => server.kill();
process.on("exit", stop);

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(BASE + "/")).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("test server did not start");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await waitForServer();
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 960 },
  recordVideo: { dir: work, size: { width: 1280, height: 960 } },
  bypassCSP: true,
  reducedMotion: "no-preference",
});
const page = await context.newPage();

// The caption overlay: appended to <html>, outside React's tree, so the app never sees it.
await page.addInitScript(() => {
  const make = () => {
    if (document.getElementById("rec-caption")) return;
    const el = document.createElement("div");
    el.id = "rec-caption";
    el.setAttribute(
      "style",
      "position:fixed;left:50%;transform:translateX(-50%);bottom:18px;width:calc(100% - 48px);max-width:1120px;box-sizing:border-box;z-index:2147483647;padding:14px 28px;background:rgba(0,0,0,0.78);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.28);border-radius:28px;color:#fff;font:500 22px/1.35 system-ui,Segoe UI,sans-serif;text-align:center;pointer-events:none",
    );
    document.documentElement.appendChild(el);
  };
  document.addEventListener("DOMContentLoaded", make);
  if (document.readyState !== "loading") make();
});
const caption = async (text) => {
  await page.evaluate((t) => {
    const el = document.getElementById("rec-caption");
    if (el) el.textContent = t;
  }, text);
};

const step = () => page.getByTestId("viewer").getAttribute("data-step").then(Number);
const stepsTotal = async () => Number((await page.getByTestId("step-label").innerText()).match(/of\s+(\d+)/)?.[1] ?? 0);
const next = () => page.getByRole("button", { name: "Next" }).click();
const toStep = async (n, pause = 700) => {
  while ((await step()) < n) {
    await next();
    await sleep(pause);
  }
};

// ---- Act 1: Snapshot Isolation ----
await page.goto(`${BASE}/anomalies/write-skew?level=SI`);
await page.getByTestId("viewer").waitFor();
await page.waitForFunction(() => document.querySelector('[data-testid="viewer"]')?.getAttribute("data-ready") === "true");
await page.evaluate(() => window.scrollTo(0, 430));
await caption("Hospital rule: at least one doctor must stay on call. Two are on call.");
await sleep(3200);
const total = await stepsTotal();
await caption("Snapshot Isolation: Alice and Bob each check the roster, then each goes off call.");
await toStep(Math.max(1, Math.floor(total * 0.45)), 900);
await caption("Each sees two on call in their own snapshot. Their writes touch different rows, so neither blocks.");
await toStep(total, 800);
await caption("Both commit. Zero doctors on call. The invariant is violated.");
await sleep(3800);

// ---- Act 2: flip to Serializable ----
await caption("Same schedule, same clicks. Now at Serializable.");
await page.locator('label:has([data-testid="level-SER"])').click();
await sleep(1800);
await page.keyboard.press("r"); // keyboard reset, a documented shortcut
await page.evaluate(() => window.scrollTo(0, 430));
await sleep(900);
await toStep(Math.max(1, Math.floor(total * 0.45)), 800);
await caption("The engine records which transaction read what the other one wrote.");
await toStep(total, 800);
await caption("T2 is aborted: read/write dependencies between the two. One doctor stays on call. The invariant holds.");
await sleep(4200);

const videoPath = await page.video().path();
await context.close();
await browser.close();
stop();

const raw = join(OUT, "hero.raw.webm");
copyFileSync(videoPath, raw);
console.log(`raw video: ${raw} (${(statSync(raw).size / 1e6).toFixed(2)} MB)`);
if (RAW_ONLY) process.exit(0);

// ---- encode ----
const ff = (args) => spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
if (spawnSync("ffmpeg", ["-version"]).status !== 0) {
  console.error(`ffmpeg not found. The raw video is at ${raw}. To make the files yourself:\n  ffmpeg -i "${raw}" -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart hero.mp4\n  ffmpeg -i "${raw}" -vf "fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" hero.gif`);
  process.exit(1);
}
const mp4 = join(OUT, "hero.mp4");
ff(["-i", raw, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "24", "-movflags", "+faststart", "-an", mp4]);
console.log(`mp4: ${mp4} (${(statSync(mp4).size / 1e6).toFixed(2)} MB)`);

// The GIF must be at most 5 MB (spec 13.1): try larger settings first, back off until it fits.
const gif = join(OUT, "hero.gif");
const LIMIT = 5 * 1024 * 1024;
const tries = [
  { fps: 12, w: 960, colors: 128 },
  { fps: 10, w: 880, colors: 112 },
  { fps: 10, w: 800, colors: 96 },
  { fps: 8, w: 720, colors: 80 },
  { fps: 8, w: 640, colors: 64 },
  { fps: 6, w: 560, colors: 48 },
];
let ok = false;
for (const t of tries) {
  ff(["-i", raw, "-vf", `fps=${t.fps},scale=${t.w}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${t.colors}[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, "-loop", "0", gif]);
  const size = statSync(gif).size;
  console.log(`gif ${t.w}px ${t.fps}fps ${t.colors} colours: ${(size / 1e6).toFixed(2)} MB`);
  if (size <= LIMIT) {
    ok = true;
    break;
  }
}
if (!ok) {
  console.error("The GIF is still over 5 MB with the smallest setting; use hero.mp4 for the README instead.");
  process.exit(1);
}
