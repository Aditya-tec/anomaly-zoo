# Decisions

Dated log of toolchain versions, sizes, free-tier checks, and every deviation from `spec.md`.

## 2026-10-20 — Initial scaffold
- Repo scaffolded from spec §3.5. Scenarios (§6.1) and `expected.json` (Appendix A) copied verbatim.
- Free-tier terms (§2) not yet re-verified — tracked as AC0.6 (owner does AC0.2–AC0.6).

## 2026-10-20 — Owner-approved DSL choices
1. **Scenario ids** use `[a-z][a-z0-9-]{0,39}`. The spec's `ID` rule (`[a-z][a-z0-9_]{0,15}`) applies to variables only; the spec was wrong for scenario ids (`non-repeatable-read` is 19 chars with hyphens).
2. **Binary `+` and `-` need spaces around them** (`-` is also a key character). A word like `a-1` in an expression is rejected with the hint "write `a - 1`". Tested.
3. **Over-length title (80), story (400), NOTE (120), invariant name (80) are rejected with an error, never truncated.** Other limits: source 8192 B, 200 steps, 64 keys, key 32, identifier 16.

## 2026-10-20 — Toolchain and AC0.1
- Go toolchain: `go1.27.0 windows/amd64`. `go.mod` has `go 1.22` as a floor; the pinned `toolchain` line is added at P5 with the reproducible WASM build.
- AC0.1 hello-world WASM (`GOOS=js GOARCH=wasm`, `-trimpath -ldflags="-s -w -buildid="`): **raw 1,975,866 B (1.88 MiB), gzip 586,004 B (572 KiB)**. Limit 1.5 MB gzip, target 1.0 MB: passes. Re-measure with the real engine at P5.

## 2026-10-20 — Windows hygiene
- `.gitattributes` forces LF. Lexer accepts CRLF; `Format` and all trace/digest output use `\n` only.
- `make` is optional; docs/DEV.md lists plain `go` commands. `go test -race` is CI-only (needs cgo/gcc on Windows).

## 2026-10-20 — P2–P4 engine: deviations from the spec and guesses
Nothing in §4 was changed, and `expected.json` and the goldens were never edited to make a test pass. Everything below is either additive or a spec gap.

**Trace schema (§5.8 is an "e.g." shape; additions are backward compatible)**
- Events carry extra optional fields `reason` (abort/skip/block reason code) and `blockedOn`. A user `ABORT` event has status `aborted`, reason `abort_user`.
- `storeAfter` lists the full store after every event (not a delta). Largest canned trace is under 7 KB, so the 20 KB budget holds. A 200-step, 64-key playground trace can be large; revisit if the UI needs it.
- `snapshotTS` is 0 until a transaction's first data operation (and at RU/RC). `stmtTS` is the clock at the start of a READ/SCAN/PUT/DELETE and 0 for other ops.
- `reads` has one entry for the version the reader saw (or `absent`), then one entry per version it could not see (`invisible_*`). `rw_edge` effects also carry `reason: rw_edge_added`.
- Steps queued behind a blocked statement that are later discarded because the transaction aborted are emitted as `skipped` events with `resumed: true`.
- Canonical JSON: keys sorted, HTML escaping off, `\n` never emitted. Digest = SHA-256 hex of the canonical JSON without the digest field.
- JSON Schema validation uses a small in-repo validator (stdlib only) covering exactly the keywords `trace.schema.json` uses.

**Semantics left open by the spec (guesses)**
- A doomed transaction that issues an explicit `ABORT` records `abort_user`, not `abort_dependencies` (it is rolled back either way).
- `expected.json` `mechanism` is derived as: first engine-initiated abort reason if any, else `visibility` when the invariant holds, else `none`. This reproduces all 32 cells.
- An invariant over an unbound variable is `n/a` (spec), also when the cause is an arithmetic range error.
- SIREAD lock choice for the `via` label of a rule-3 edge: an exact key lock wins over a prefix lock; among prefixes the lexicographically first.
- Rule 1/2 edge sources are all writers of versions that are uncommitted or committed after the reader's snapshot (one edge per writer, deduplicated).

**Structure**
- Added packages `engine/gen` (schedule generator, splitmix64) and `engine/matrix` (matrix compute/diff). `oracle/detectors.go` was not needed and does not exist. `run.Exec` additionally returns the manager so tests can check store invariants.
- `ssi.Fault` is a package-level struct of test-only fault switches (AC4.3). It is never set outside tests.
- Property tests sample the expensive P1 checks: schema validation every 25th schedule, digest re-run every 10th, mid-run chain shape every 10th. All other properties run on every schedule.

**Mutation checks (AC4.3) — honest result**
Disabling edge rules 1, 2 and 3 is caught by random schedules or canned scenarios (rule 3 breaks write-skew and read-only-anomaly) and shrinks to 8 steps. Disabling the commit-time check or the after-commit re-check is *not* visible to serializability checks: a dangerous structure can only appear when an edge is added or when O commits, and both moments are checked, so each of those two rules is redundant for correctness (defense in depth). They are covered by targeted tests (`commitCheckSeesDanger`, `afterCommitDoomsImmediately`): the after-commit re-check dooms the pivot at its next operation instead of at COMMIT.