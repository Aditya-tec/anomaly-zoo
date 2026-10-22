// Launch stills (spec 13.1 items 2, 3, 5), made from the REAL built site and from recorded numbers:
//   habitat-map-light.png, habitat-map-dark.png   the map, clean
//   how-verified.png, engine-diagram.png          the verification diagram (measured numbers) and how the engine works
//   carousel-1-bug.png, carousel-2-fix.png, carousel-3-proof.png   1080 x 1350
// Run from web/ after `npm run build`:  node scripts/launch-stills.mjs
// Numbers come from web/public/conformance.json and docs/PROGRESS.md at run time; if the
// sentence in PROGRESS.md that carries the oracle numbers changes, this script stops instead of guessing.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const PORT = 4176;
const BASE = `http://127.0.0.1:${PORT}`;
const root = resolve(process.cwd(), "..");
const OUT = join(root, "docs", "launch");
mkdirSync(OUT, { recursive: true });

// ---- numbers: recorded sources only ----
const conf = JSON.parse(readFileSync(join(root, "web", "public", "conformance.json"), "utf8"));
const progress = readFileSync(join(root, "docs", "PROGRESS.md"), "utf8");
const ac42 = progress.split("\n").find((l) => l.includes("AC4.2"));
if (!ac42 || !/20,000 SER schedules/.test(ac42) || !/200,000 run locally/.test(ac42) || !/0 oracle rejections/.test(ac42)) {
  throw new Error("docs/PROGRESS.md AC4.2 no longer carries the oracle numbers this diagram quotes; update the script deliberately");
}
const pct = (n, d, digits = 1) => `${((100 * n) / d).toFixed(digits)}%`;
const f = (n) => n.toLocaleString("en-US");
const R = conf.random;
const lines = {
  oracleDefault: "20,000 random schedules per level in every test run",
  oracleLong: "200,000 Serializable schedules in one local run",
  oracleResult: "0 histories rejected by the oracle",
  rc: `Read Committed: ${R.RC.identical} of ${R.RC.compared} identical (${pct(R.RC.identical, R.RC.compared)})`,
  si: `Snapshot Isolation: ${R.SI.identical} of ${R.SI.compared} identical (${pct(R.SI.identical, R.SI.compared)})`,
  noRace: `For context only: with no two statements blocked at once, ${R.RC.noRaceIdentical} of ${R.RC.noRaceCompared} (RC) and ${R.SI.noRaceIdentical} of ${R.SI.noRaceCompared} (SI), a subset chosen after the fact to explain the differences, not an independent result`,
  ser: `Serializable: both sides serializable in ${R.SER.engineSerializable} of ${R.SER.schedules}; same aborted set in ${pct(R.SER.abortSetsIdentical, R.SER.schedules)}`,
  corpus: `${f(conf.corpus.randomPerLevel)} random schedules per level + ${conf.canned.length} canned scenarios, PostgreSQL ${conf.postgresVersion.split(" ")[0]}`,
  divergences: `${conf.knownDivergences.length} differences documented, each with a minimal schedule`,
};

const server = spawn(process.execPath, ["scripts/serve.mjs", String(PORT)], { stdio: "ignore" });
process.on("exit", () => server.kill());
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(BASE + "/")).ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- habitat map, light and dark ----
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(BASE + "/");
  await page.getByTestId("habitat-map").waitFor();
  await sleep(400);
  await page.getByTestId("habitat-map").screenshot({ path: join(OUT, `habitat-map-${scheme}.png`) });
  await ctx.close();
}

// ---- carousel 1 and 2: the bug, the fix (real page, caption overlay added by this script only) ----
async function story(level, file, headline) {
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1350 }, colorScheme: "light", bypassCSP: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/anomalies/write-skew?level=${level}`);
  await page.waitForFunction(() => document.querySelector('[data-testid="viewer"]')?.getAttribute("data-ready") === "true");
  const total = Number((await page.getByTestId("step-label").innerText()).match(/of\s+(\d+)/)[1]);
  for (let i = 0; i < total; i++) await page.getByRole("button", { name: "Next" }).click();
  await page.evaluate(() => window.scrollTo(0, 110));
  await page.evaluate((t) => {
    const el = document.createElement("div");
    el.setAttribute("style", "position:fixed;left:0;right:0;bottom:0;padding:22px 32px;background:rgba(10,14,25,0.94);color:#fff;font:700 34px/1.25 system-ui,Segoe UI,sans-serif;text-align:center");
    el.textContent = t;
    document.documentElement.appendChild(el);
  }, headline);
  await sleep(300);
  await page.screenshot({ path: join(OUT, file) });
  await ctx.close();
}
await story("SI", "carousel-1-bug.png", "The bug: both doctors go off call. Zero on call.");
await story("SER", "carousel-2-fix.png", "The fix: at Serializable, T2 is aborted. One stays on call.");

// ---- the verification diagram (landscape) and the proof still (portrait) ----
function diagramHtml(w, h, portrait) {
  const box = (title, body, color) => `<div class="box" style="border-color:${color}"><h3 style="color:${color}">${title}</h3>${body}</div>`;
  const arrow = `<div class="arrow" style="font-size:${portrait ? 36 : 56}px;line-height:1">${portrait ? "&darr;" : "&rarr;"}</div>`;
  return `<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{margin:0;width:${w}px;height:${h}px;background:#fbfaf7;color:#16181d;font:500 ${portrait ? 24 : 24}px/1.3 system-ui,Segoe UI,sans-serif;padding:${portrait ? 48 : 44}px}
    h1{margin:0 0 6px;font-size:${portrait ? 42 : 38}px} .sub{color:#4d5561;margin:0 0 ${portrait ? 28 : 22}px;font-size:${portrait ? 26 : 22}px}
    .flow{display:flex;flex-direction:${portrait ? "column" : "row"};gap:14px;align-items:stretch}
    .box{flex:1;border:4px solid;border-radius:14px;padding:18px 22px;background:#fff} .box h3{margin:0 0 8px;font-size:${portrait ? 32 : 28}px}
    .box p{margin:6px 0} .arrow{align-self:center;font-size:56px;color:#4d5561}
    .big{font-size:${portrait ? 40 : 34}px;font-weight:800} .src{position:absolute;left:${portrait ? 56 : 44}px;right:${portrait ? 56 : 44}px;bottom:${portrait ? 40 : 28}px;color:#4d5561;font-size:${portrait ? 21 : 18}px}
  </style>
  <h1>How it is verified</h1><p class="sub">${lines.corpus}</p>
  <div class="flow">
    ${box("Engine", "<p>Go, standard library only.</p><p>Runs a schedule at four isolation levels and records every step.</p>", "#1b5fa6")}
    ${arrow}
    ${box("Serializability oracle", `<p class="big">${lines.oracleResult}</p><p>${lines.oracleDefault}</p><p>${lines.oracleLong}</p>`, "#17683d")}
  </div>
  <div class="flow" style="margin-top:${portrait ? 22 : 16}px">
    ${box("Engine", portrait ? "<p>The same schedules at RC, SI and SER, compared statement by statement.</p>" : "<p>The same schedules, run at Read Committed, Snapshot Isolation and Serializable.</p><p>Compared statement by statement: results, final state, which transactions aborted.</p>", "#1b5fa6")}
    ${arrow.replace(portrait ? "&darr;" : "&rarr;", portrait ? "&harr;" : "&harr;")}
    ${box(`PostgreSQL ${conf.postgresVersion.split(" ")[0]}`, `<p>${lines.rc}</p><p>${lines.si}</p><p style="font-size:0.8em;color:#4d5561;font-style:italic">${lines.noRace}</p><p>${lines.ser}</p><p>${lines.divergences}</p>`, "#a04800")}
  </div>
  <div class="src">Sources: docs/PROGRESS.md (oracle runs), web/public/conformance.json (PostgreSQL comparison). Differences are listed on the About page.</div>`;
}
async function diagram(file, w, h, portrait) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: portrait ? 1 : 1.5 });
  const page = await ctx.newPage();
  await page.setContent(diagramHtml(w, h, portrait));
  await page.screenshot({ path: join(OUT, file) });
  await ctx.close();
}
await diagram("how-verified.png", 1600, 900, false);
await diagram("carousel-3-proof.png", 1080, 1350, true);

// ---- the engine diagram: snapshots, lock waits, dependency tracking (X post 3) ----
function engineHtml(w, h) {
  const col = (title, color, body) => `<div class="c" style="border-color:${color}"><h2 style="color:${color}">${title}</h2>${body}</div>`;
  const ver = (t, text, dim) => `<div class="v${dim ? " dim" : ""}"><b>${t}</b> ${text}</div>`;
  return `<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{margin:0;width:${w}px;height:${h}px;background:#fbfaf7;color:#16181d;font:500 21px/1.35 system-ui,Segoe UI,sans-serif;padding:40px}
    h1{margin:0 0 4px;font-size:38px} .sub{color:#4d5561;margin:0 0 22px;font-size:21px}
    .row{display:flex;gap:18px} .c{flex:1;border:4px solid;border-radius:14px;padding:16px 20px;background:#fff;min-height:640px}
    h2{margin:0 0 6px;font-size:28px} p{margin:8px 0} .v{font-family:Consolas,monospace;font-size:19px;border:2px solid #16181d;border-radius:8px;padding:6px 10px;margin:6px 0;background:#f3f1ea} .v.dim{border-style:dashed;color:#6a7280}
    .lane{display:flex;gap:10px;margin:8px 0;align-items:center} .t{font-family:Consolas,monospace;font-weight:700;border-radius:8px;padding:4px 10px;color:#fff;font-size:19px}
    .t1{background:#1b5fa6} .t2{background:#a04800} .arr{font-size:30px;color:#4d5561}
    .note{color:#4d5561;font-size:18px} .bad{color:#a6203a;font-weight:700}
    .src{position:absolute;left:40px;right:40px;bottom:22px;color:#4d5561;font-size:17px}
  </style>
  <h1>How the engine works</h1><p class="sub">A deterministic simulation: one schedule in, one trace out.</p>
  <div class="row">
  ${col("1. Snapshots", "#1b5fa6", `<p>Every key keeps a chain of versions, each stamped with its writer and a commit timestamp.</p>
    ${ver("@3", "x = 70  (T2, committed)")}${ver("@1", "x = 50  (setup, committed)", true)}
    <p>T1 takes its snapshot at its first read or write, here at timestamp 2. It reads the newest version committed at or before that: <b>x = 50</b>, even after T2 commits x = 70.</p>
    <p class="note">Read Committed re-reads at every statement instead; Read Uncommitted also sees uncommitted versions.</p>`)}
  ${col("2. Lock waits", "#a04800", `<p>Every write takes the key's write lock. If another transaction holds it, the statement waits, and the schedule goes on.</p>
    <div class="lane"><span class="t t1">T1</span> holds the lock on x</div>
    <div class="lane"><span class="t t2">T2</span> PUT x &rarr; <b>waits</b></div>
    <div class="lane"><span class="t t2">T3</span> PUT x &rarr; <b>waits</b> behind T2</div>
    <p>When T1 commits or aborts, waiters are retried first in, first out. A cycle of waits aborts the transaction that closed it.</p>
    <p>At Snapshot Isolation a waiter that finds a newer committed version is aborted: <span class="bad">first updater wins</span>.</p>`)}
  ${col("3. Dependency tracking", "#17683d", `<p>At Serializable the engine also records read-write dependencies: A &rarr; B when A read something that B overwrote.</p>
    <div class="lane"><span class="t t1">T1</span><span class="arr">&rarr;</span><span class="t t2">T2</span> T1 read what T2 wrote</div>
    <div class="lane"><span class="t t2">T2</span><span class="arr">&rarr;</span><span class="t t1">T1</span> T2 read what T1 wrote</div>
    <p>Two such edges around one transaction, with the other side committed first, form a dangerous pattern. The engine aborts one: <span class="bad">T2 aborted</span>, the transactions that commit give a result some serial order also gives.</p>
    <p class="note">Simplified: key and key-prefix read locks, no read-only optimisation.</p>`)}
  </div>
  <div class="src">Illustrative values. Rules: docs/METHODOLOGY.md, "Engine semantics (summary)"; full contract: spec section 4.</div>`;
}
{
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  await page.setContent(engineHtml(1600, 900));
  await page.screenshot({ path: join(OUT, "engine-diagram.png") });
  await ctx.close();
}

await browser.close();
server.kill();
console.log("wrote stills to", OUT);
console.log(JSON.stringify(lines, null, 2));
