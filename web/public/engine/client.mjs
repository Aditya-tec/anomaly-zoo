// Main-thread client for the engine worker (spec §5.9). Every call is
// rejected if it takes longer than `timeoutMs` (default 2000); the worker is
// then terminated and a fresh one is started for the next call.
//
// `spawn` must return an object with postMessage / terminate and an
// assignable onmessage / onerror, i.e. a Worker or a test stub.

export function createEngine({ spawn, timeoutMs = 2000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let worker = null;
  let nextId = 1;
  const pending = new Map(); // id -> {resolve, reject, timer}

  function failAll(message) {
    for (const [id, p] of pending) {
      clearTimer(p.timer);
      p.reject(new Error(message));
      pending.delete(id);
    }
  }

  function start() {
    const w = spawn();
    w.onmessage = (ev) => {
      const { id, result, error } = ev.data || {};
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimer(p.timer);
      if (error !== undefined) p.reject(new Error(error));
      else p.resolve(result);
    };
    w.onerror = () => {
      if (worker === w) {
        worker = null;
        try { w.terminate(); } catch (_) { /* already gone */ }
        failAll("engine worker crashed");
      }
    };
    return w;
  }

  function restart() {
    if (worker) {
      try { worker.terminate(); } catch (_) { /* already gone */ }
      worker = null;
    }
  }

  function call(method, ...args) {
    if (!worker) worker = start();
    const id = nextId++;
    const w = worker;
    return new Promise((resolve, reject) => {
      const timer = setTimer(() => {
        if (!pending.has(id)) return;
        // Terminate the worker, which also drops every other in-flight call.
        if (worker === w) restart();
        pending.delete(id);
        reject(new Error(`engine call "${method}" timed out after ${timeoutMs} ms; worker restarted`));
        failAll("engine worker restarted");
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      w.postMessage({ id, method, args });
    });
  }

  return {
    version: () => call("version"),
    parse: (src) => call("parse", src),
    run: (src, level) => call("run", src, level),
    runAll: (src) => call("runAll", src),
    terminate: () => { restart(); failAll("engine terminated"); },
  };
}
