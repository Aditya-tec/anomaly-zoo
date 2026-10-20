// Drives a Chromium-based browser (Chrome or Edge) over the DevTools protocol:
// loads the served spike, waits for the page to finish, and reports the result
// plus every console error, exception, CSP violation and failed request seen by
// the page AND its workers. Exit code 1 unless status is OK with zero problems.
//
//   node scripts/browser-check.mjs --browser "<path to chrome.exe|msedge.exe>" [--url http://127.0.0.1:4173/] [--timeout 40000]
//
// The server (npm run serve) must already be running.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const browser = opt("--browser");
const url = opt("--url", "http://127.0.0.1:4173/");
const timeout = Number(opt("--timeout", "40000"));
if (!browser) { console.error("--browser is required"); process.exit(2); }

const profile = mkdtempSync(join(tmpdir(), "azoo-browser-"));
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(browser, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
let result = null;

async function main() {
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(100); }
  }
  if (!targets) throw new Error("browser did not start");
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let nextId = 1;
  const waiting = new Map();
  const send = (method, params = {}, sessionId) => new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg.result); waiting.delete(msg.id); return; }
    const who = msg.sessionId ? "worker" : "page";
    switch (msg.method) {
      case "Target.attachedToTarget": {
        const sid = msg.params.sessionId;
        await send("Runtime.enable", {}, sid);
        await send("Log.enable", {}, sid);
        await send("Runtime.runIfWaitingForDebugger", {}, sid);
        break;
      }
      case "Runtime.consoleAPICalled":
        if (["error", "assert"].includes(msg.params.type)) problems.push(`${who} console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
        break;
      case "Runtime.exceptionThrown":
        problems.push(`${who} exception: ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description ?? ""}`);
        break;
      case "Log.entryAdded":
        if (["error", "warning"].includes(msg.params.entry.level)) problems.push(`${who} log.${msg.params.entry.level}: ${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
        break;
      case "Network.loadingFailed":
        problems.push(`${who} request failed: ${msg.params.errorText} ${msg.params.blockedReason ?? ""}`);
        break;
      case "Network.responseReceived":
        if (msg.params.response.status >= 400) problems.push(`${who} HTTP ${msg.params.response.status}: ${msg.params.response.url}`);
        break;
    }
  };

  await send("Runtime.enable");
  await send("Log.enable");
  await send("Network.enable");
  await send("Page.enable");
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  await send("Page.navigate", { url });

  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await sleep(250);
    const r = await send("Runtime.evaluate", {
      expression: `(() => { const el = document.getElementById("result"); return el ? JSON.stringify({ status: el.dataset.status, violations: Number(el.dataset.violations), text: el.textContent }) : null; })()`,
      returnByValue: true,
    });
    const v = r && r.result && r.result.value;
    if (v) {
      const parsed = JSON.parse(v);
      if (parsed.status !== "RUNNING") { result = parsed; break; }
    }
  }
  await sleep(500); // let late console messages arrive
  ws.close();
}

try {
  await main();
} catch (e) {
  problems.push("harness error: " + e.message);
} finally {
  proc.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* browser may still hold files */ }
}

console.log(result ? result.text : "(page never left RUNNING)");
console.log("\nproblems seen (console errors, exceptions, CSP violations, failed requests):");
console.log(problems.length ? problems.map((p) => "  - " + p).join("\n") : "  none");
const ok = result && result.status === "OK" && result.violations === 0 && problems.length === 0;
console.log(ok ? "\nBROWSER CHECK: PASS" : "\nBROWSER CHECK: FAIL");
process.exit(ok ? 0 : 1);
