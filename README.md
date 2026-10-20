# Anomaly Zoo

Watch database isolation bugs happen, then turn them off.

Anomaly Zoo is a from-scratch transactional engine (multi-version concurrency control, written in Go with only the standard library) that runs scripted two- and three-transaction schedules at four isolation levels: Read Uncommitted, Read Committed, Snapshot Isolation and Serializable. You step through a schedule, see a bug happen (a dirty read, a lost update, write skew), switch the level, replay, and see the mechanism that prevents it.

> **Status: engine only.** The engine, command line, WASM build and tests exist. The website (habitat map, step-through pages, playground) is **not built yet**, and there is **no PostgreSQL comparison yet**. See [Status](#status).

## What exists today

- `engine/`: DSL parser, MVCC store, transaction manager (write locks, deadlock detection, first-updater-wins), a simplified Serializable Snapshot Isolation tracker, a serializability oracle, and a trace format with a JSON Schema.
- `scenarios/`: eight scenarios (dirty read, non-repeatable read, phantom, lost update, read skew, write skew, read-only anomaly, deadlock) and `expected.json`, the result matrix the engine is checked against.
- `cmd/azoo`: `run`, `matrix`, `traces`, `gen`, `version`.
- `web/public/engine`: the engine compiled to WebAssembly, a worker and a client (no website around them yet).
- `spike/`: a throwaway Next.js page used to prove that the worker, the WASM and a strict Content-Security-Policy work together on a static host. It is not the site.

## Try it

Requires Go (the version in `go.mod`) and, for the browser-side checks, Node 22.

```
go run ./cmd/azoo matrix scenarios --check
go run ./cmd/azoo run scenarios/write-skew.azs --level SI
go run ./cmd/azoo run scenarios/write-skew.azs --level SER
go test ./...
node --test scripts/engine.test.mjs
```

More commands (no `make` needed) are in [docs/DEV.md](docs/DEV.md).

## How it is checked

Numbers below are from runs recorded in [docs/PROGRESS.md](docs/PROGRESS.md).

- The matrix (8 scenarios x 4 levels) is computed by running the engine and compared with `scenarios/expected.json`; it is not hard-coded anywhere.
- The Serializable level was checked against a serializability oracle on 20,000 random schedules per test run, and on 200,000 random schedules in a one-off local run: 0 histories rejected.
- The same 200,000-schedule run was repeated twice with one SSI rule disabled each; neither found a non-serializable history, which is evidence those two rules are redundant for correctness, not proof.
- Deliberately breaking each of five SSI rules makes a test fail (random schedules for three of them, targeted tests for the other two).
- The WASM build is reproducible (two cold builds give the same SHA-256), and its trace digests equal the native ones for all 32 canned traces plus 400 random ones, checked under Node.

## Limitations

Please read these before relying on anything here.

1. It is a **key-to-integer model with prefix scans**. There is no SQL, no indexes, no durability and no query planner.
2. It is a **deterministic, single-threaded simulation of interleavings**, not real concurrency. A schedule is a fixed script; the engine does not find races by itself.
3. **Read Uncommitted exists only to show dirty reads.** PostgreSQL has no equivalent (it treats Read Uncommitted as Read Committed; this is unverified here).
4. **The Serializable level is "SSI-lite".** Predicate locks are key-prefix only, there is no read-only optimisation and nothing is summarised or evicted, so it can abort more transactions than a production database would. Passing random schedules against an oracle is evidence, not a proof of correctness.
5. **No claim is made about any real database yet.** Comparison with PostgreSQL is planned (phase P8) and not done. Nothing here describes MySQL, Oracle or SQL Server.
6. The WASM file is large: 1.43 MB gzip (about 1.04 MB brotli), mostly because Go's `encoding/json` pulls in `reflect`.
7. Browser support is unverified beyond Chrome and Edge on Windows (spike only).

Your own database's documentation is the authority on how it behaves.

## Status

| Phase | State |
|---|---|
| P1 DSL, P2-P4 engine (RU, RC, SI, SER), P5 CLI/traces/WASM | done, tests recorded in docs/PROGRESS.md |
| P0 hosting spike (Vercel preview, CSP in three browsers, CI) | files written; hosted checks pending, see docs/P0-CHECKLIST.md |
| P6-P7 website and playground | not started |
| P8 PostgreSQL comparison | not started |
| P9-P10 hardening and launch | not started |

The full plan is in [spec.md](spec.md).

## License

MIT, see [LICENSE](LICENSE).
