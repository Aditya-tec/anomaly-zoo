# Progress

Toolchain: go1.27.0 windows/amd64.

## P0 — Spike and gates
- [x] AC0.1 WASM hello builds; gzip 586,004 B (limit 1.5 MB) — see DECISIONS.md
- [ ] AC0.2 Worker instantiates WASM on Vercel preview, zero CSP violations (3 browsers) — owner
- [ ] AC0.3 Next static export per-page meta CSP works — owner
- [ ] AC0.4 `engine.json` no-cache, hashed engine files immutable — owner
- [ ] AC0.5 CI Postgres service container `SELECT 1` — owner
- [ ] AC0.6 Free-tier terms re-verified and dated — owner

## P1 — DSL
- [x] AC1.1 8 scenarios parse; Format round-trips (also for CRLF copies)
- [x] AC1.2 Errors carry line/col, ≤ 20 reported; 55 test results in `engine/dsl` (≥ 30 parser tests)
- [x] AC1.3 FuzzParse 5 min: 23,761,741 execs, 444 corpus entries, no failures. Seeds are the 8 scenarios + minimal, added with `f.Add` (no failing inputs exist, so `testdata/fuzz/` is empty)

## P2 — Engine core: RU and RC
- [x] AC2.1 Hand-verified traces: lost-update@RC final=130 (T2 blocked, resumed with lock_granted_after_wait); dirty-read@RU reads 2 (visible_dirty); deadlock aborts T2 and resumes T1's PUT b (all in engine/run/run_test.go)
- [x] AC2.2 RU/RC matrix columns equal expected.json (engine/matrix TestMatrixRURC)
- [x] AC2.3 All 16 RU/RC traces validate against trace.schema.json, two runs give identical bytes/digests, each < 20 KB (largest 6.4 KB); golden files in engine/testdata/golden
- [x] AC2.4 Unit tests for visibility, lock handoff, FIFO wake + re-block, queued steps, drain re-block/abort, deadlock, blocked_at_end. Coverage of mvcc+txn+run combined 90.2 % (the uncovered code is the SI/SER hooks, added in P3/P4)

## P3 — Snapshot isolation
- [ ] AC3.1 SI column matches
- [ ] AC3.2 P1–P5 at SI, P7 guard

## P4 — SSI and oracle
- [ ] AC4.1 SER column matches; walk-throughs reproduce
- [ ] AC4.2 P6 20k in CI, 200k local
- [ ] AC4.3 Mutation checks
- [ ] AC4.4 Oracle unit tests

## P5–P10
See spec §12.
