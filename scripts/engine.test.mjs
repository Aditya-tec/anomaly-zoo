// Run with: node --test scripts/
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createEngine } from "../web/public/engine/client.mjs";
import { checkDigests, loadEngine } from "./wasm-digest-check.mjs";

const ENGINE = "web/public/engine";

// ---- client: timeout, restart, errors (stub worker, as in AC5.3) -----------

function stubFactory(behaviour) {
  const spawned = [];
  const spawn = () => {
    const w = {
      terminated: false,
      postMessage(msg) {
        behaviour(w, msg);
      },
      terminate() { w.terminated = true; },
    };
    spawned.push(w);
    return w;
  };
  return { spawn, spawned };
}

test("client resolves a normal reply", async () => {
  const { spawn } = stubFactory((w, m) => queueMicrotask(() => w.onmessage({ data: { id: m.id, result: { ok: true, echo: m.args } } })));
  const eng = createEngine({ spawn });
  assert.deepEqual(await eng.run("src", "SI"), { ok: true, echo: ["src", "SI"] });
});

test("client rejects after 2 s, terminates the worker and starts a fresh one", async () => {
  let n = 0;
  const { spawn, spawned } = stubFactory((w, m) => {
    n++;
    if (n === 1) return; // first call: the stub "sleeps" and never answers
    queueMicrotask(() => w.onmessage({ data: { id: m.id, result: "second worker" } }));
  });
  const eng = createEngine({ spawn, timeoutMs: 2000 });
  const t0 = Date.now();
  await assert.rejects(eng.parse("x"), /timed out after 2000 ms/);
  const waited = Date.now() - t0;
  assert.ok(waited >= 1900 && waited < 3500, `waited ${waited} ms`);
  assert.equal(spawned.length, 1);
  assert.ok(spawned[0].terminated, "hung worker was not terminated");
  assert.equal(await eng.parse("y"), "second worker");
  assert.equal(spawned.length, 2, "a fresh worker should serve the next call");
});

test("client surfaces worker errors and crashes", async () => {
  const a = stubFactory((w, m) => queueMicrotask(() => w.onmessage({ data: { id: m.id, error: "boom" } })));
  await assert.rejects(createEngine({ spawn: a.spawn }).version(), /boom/);
  const b = stubFactory((w) => queueMicrotask(() => w.onerror(new Error("x"))));
  const eng = createEngine({ spawn: b.spawn });
  await assert.rejects(eng.version(), /crashed/);
  assert.ok(b.spawned[0].terminated);
});

// ---- worker.js: the real file, in a sandbox without a network ---------------

async function bootWorker() {
  const posted = [];
  const fetched = [];
  const readEngine = (name) => readFileSync(join(ENGINE, name));
  const ctx = {
    console, URL, TextEncoder, TextDecoder, WebAssembly, crypto: globalThis.crypto, performance,
    Uint8Array, Uint16Array, Uint32Array, Float64Array, DataView, Date, Error, Promise, Map, Set,
    Object, Array, JSON, Math, Reflect, Proxy, Symbol, String, Number, Boolean, BigInt, Infinity, NaN,
    setTimeout, clearTimeout, queueMicrotask,
  };
  ctx.self = ctx;
  ctx.globalThis = ctx;
  ctx.location = { href: "http://localhost/engine/worker.js" };
  ctx.postMessage = (m) => posted.push(m);
  ctx.importScripts = (url) => {
    fetched.push(url);
    vm.runInContext(readEngine(new URL(url).pathname.split("/").pop()).toString("utf8"), ctx);
  };
  ctx.fetch = async (url) => {
    fetched.push(url);
    const name = new URL(url).pathname.split("/").pop();
    let buf;
    try { buf = readEngine(name); } catch { return { ok: false, status: 404 }; }
    return {
      ok: true, status: 200,
      json: async () => JSON.parse(buf.toString("utf8")),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(ENGINE, "worker.js"), "utf8"), ctx);
  const send = (msg) => new Promise((resolve) => {
    const before = posted.length;
    ctx.onmessage({ data: msg });
    const t = setInterval(() => { if (posted.length > before) { clearInterval(t); resolve(posted[posted.length - 1]); } }, 5);
  });
  return { ctx, send, fetched };
}

test("worker.js answers requests and returns structured errors for invalid input", async () => {
  const { ctx, send, fetched } = await bootWorker();
  const v = await send({ id: 1, method: "version", args: [] });
  assert.equal(v.id, 1);
  assert.equal(typeof v.result, "string");

  const good = readFileSync("scenarios/write-skew.azs", "utf8");
  const r = await send({ id: 2, method: "run", args: [good, "SER"] });
  assert.equal(r.result.ok, true);
  assert.equal(r.result.trace.level, "SER");

  const bad = await send({ id: 3, method: "run", args: ["scenario x\nschedule:\n  T1 FROB\n", "SI"] });
  assert.equal(bad.result.ok, false);
  assert.equal(bad.result.errors[0].line, 3);
  assert.ok(bad.result.errors[0].col >= 1 && bad.result.errors[0].message.length > 0);

  const huge = await send({ id: 4, method: "parse", args: ["#".repeat(9000)] });
  assert.equal(huge.result.ok, false);

  const lvl = await send({ id: 5, method: "run", args: [good, "XX"] });
  assert.equal(lvl.result.ok, false);

  const unknown = await send({ id: 6, method: "constructor", args: [] });
  assert.match(unknown.error, /unknown method/);

  // Network access is cut once the engine is loaded.
  for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts"]) {
    assert.equal(typeof ctx[name], "undefined", `${name} is still reachable from the worker`);
  }
  // It only ever asked for its own three files.
  assert.deepEqual(fetched.map((u) => new URL(u).pathname).sort(), [
    "/engine/azoo." + JSON.parse(readFileSync(join(ENGINE, "engine.json"), "utf8")).wasm.split(".")[1] + ".wasm",
    "/engine/engine.json",
    "/engine/wasm_exec.js",
  ].sort());
});

// ---- native vs WASM digests -------------------------------------------------

test("all 32 native and WASM trace digests are identical", async () => {
  const { compared, failures } = await checkDigests({
    engineDir: ENGINE, manifestPath: "web/public/traces/manifest.json", scenariosDir: "scenarios",
  });
  assert.deepEqual(failures, []);
  assert.equal(compared, 32);
});

test("WASM and native agree on random schedules too", async () => {
  const { azoo } = await loadEngine(ENGINE);
  const expected = JSON.parse(readFileSync("scripts/fixtures/random-digests.json", "utf8"));
  let n = 0;
  for (const [key, digest] of Object.entries(expected.digests)) {
    const [seed, level] = key.split("@");
    const res = azoo.run(expected.sources[seed], level);
    assert.equal(res.ok, true, key);
    assert.equal(res.trace.digest, digest, `${key}: WASM digest differs from native`);
    n++;
  }
  assert.ok(n >= 400, `only ${n} random digests compared`);
});

test("scenario catalogue is complete", () => {
  assert.equal(readdirSync("scenarios").filter((f) => f.endsWith(".azs")).length, 8);
});
