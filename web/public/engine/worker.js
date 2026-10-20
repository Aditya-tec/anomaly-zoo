/* Anomaly Zoo engine worker (spec §5.9). Plain JS, same origin, no network
 * beyond loading engine.json, the content-hashed WASM and wasm_exec.js.
 *
 * Protocol: the page posts {id, method, args}; the worker answers
 * {id, result} or {id, error}. Methods: version, parse, run, runAll.
 * Engine failures are data ({ok:false, errors:[...]}), never thrown.
 */
"use strict";

(function () {
  var METHODS = { version: 1, parse: 1, run: 1, runAll: 1 };
  var base = self.location.href;

  // Messages that arrive while the module is still loading wait on `ready`.
  var ready = (async function () {
    importScripts(new URL("wasm_exec.js", base).href);
    var metaRes = await fetch(new URL("engine.json", base).href, { cache: "no-cache" });
    if (!metaRes.ok) throw new Error("engine.json: HTTP " + metaRes.status);
    var meta = await metaRes.json();
    var wasmRes = await fetch(new URL(meta.wasm, base).href);
    if (!wasmRes.ok) throw new Error(meta.wasm + ": HTTP " + wasmRes.status);
    var bytes = await wasmRes.arrayBuffer();

    var go = new Go();
    var inst = await WebAssembly.instantiate(bytes, go.importObject);
    go.run(inst.instance); // never resolves: the Go program blocks forever

    // Cut every route to the network now that the files are loaded. The page
    // CSP (connect-src 'self', worker headers) is the primary control; this is
    // defence in depth against a compromised engine.
    ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "WebTransport"].forEach(function (name) {
      try {
        Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false });
      } catch (e) {
        self[name] = undefined;
      }
    });
    return self.azoo;
  })();

  self.onmessage = function (ev) {
    var msg = ev.data || {};
    var id = msg.id;
    ready.then(
      function (azoo) {
        if (!Object.prototype.hasOwnProperty.call(METHODS, msg.method)) {
          self.postMessage({ id: id, error: "unknown method " + String(msg.method) });
          return;
        }
        try {
          var args = Array.isArray(msg.args) ? msg.args : [];
          self.postMessage({ id: id, result: azoo[msg.method].apply(azoo, args) });
        } catch (e) {
          self.postMessage({ id: id, error: String(e) });
        }
      },
      function (e) {
        self.postMessage({ id: id, error: "engine failed to load: " + String(e) });
      }
    );
  };
})();
