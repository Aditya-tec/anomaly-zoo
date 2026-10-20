"use client";

import { useEffect, useState } from "react";
import golden from "./golden.json";

// P0 spike (AC0.2/AC0.3): load the engine worker through client.mjs, run
// write-skew at SER and compare the digest with the committed golden trace.
export default function Page() {
  const [state, setState] = useState({ status: "RUNNING" });
  const [violations, setViolations] = useState([]);

  useEffect(() => {
    const onViolation = (e) =>
      setViolations((v) => [...v, `${e.violatedDirective} blocked ${e.blockedURI || "inline"}`]);
    document.addEventListener("securitypolicyviolation", onViolation);

    let engine;
    (async () => {
      try {
        // Same-origin module from /engine; webpackIgnore keeps the bundler out of it.
        const { createEngine } = await import(/* webpackIgnore: true */ "/engine/client.mjs");
        engine = createEngine({ spawn: () => new Worker("/engine/worker.js"), timeoutMs: 10000 });
        const version = await engine.version();
        const res = await engine.run(golden.source, golden.level);
        if (!res.ok) throw new Error("engine returned errors: " + JSON.stringify(res.errors));
        const digest = res.trace.digest;
        setState({ status: digest === golden.digest ? "OK" : "MISMATCH", digest, version });
      } catch (e) {
        setState({ status: "ERROR", error: String(e && e.message ? e.message : e) });
      }
    })();

    return () => {
      document.removeEventListener("securitypolicyviolation", onViolation);
      if (engine) engine.terminate();
    };
  }, []);

  return (
    <main>
      <h1>Anomaly Zoo: P0 spike</h1>
      <p>
        write-skew at SER, run by the Go WASM engine in a Web Worker. This page is a spike, not the
        site.
      </p>
      <pre id="result" data-status={state.status} data-violations={violations.length}>
        {`status:        ${state.status}
engine:        ${state.version ?? "-"}
digest (wasm): ${state.digest ?? "-"}
digest (gold): ${golden.digest}
csp violations seen by the page: ${violations.length}${violations.map((v) => "\n  - " + v).join("")}${
          state.error ? "\nerror: " + state.error : ""
        }`}
      </pre>
    </main>
  );
}