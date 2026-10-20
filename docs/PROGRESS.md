# Progress

Toolchain: go1.27.0 windows/amd64.

## P0 — Spike and gates
- [x] AC0.1 WASM hello builds; gzip 586,004 B (limit 1.5 MB) — see DECISIONS.md
- [ ] AC0.2 Worker instantiates WASM on Vercel preview, zero CSP violations (3 browsers) — owner. Files ready (spike/, docs/P0-CHECKLIST.md). Evidence on https://anomaly-zoo.vercel.app (commit c41ffe6, 2026-10-20): headless Chrome and Edge PASS (status OK, digests equal, 0 CSP violations, 0 console errors/failed requests, page and worker consoles). NOT yet run: Firefox, WebKit/Safari. Owner ticks this once all three engines pass
- [ ] AC0.3 Next static export per-page meta CSP works — owner. Local: build + verify-csp OK (3 pages, 9 hashes), inline script hashes independently recomputed, negative control blocked; Deployed: `node spike/scripts/check-deployed.mjs` PASS on the live URL (meta CSP present before the first script, 3/3 inline scripts hashed, no unsafe-inline/eval; the 404 page also has it). An earlier deployment through the Next.js preset had NO meta (fixed, see DECISIONS.md). Owner to confirm and tick
- [ ] AC0.4 `engine.json` no-cache, hashed engine files immutable — owner. Local: verified against serve.mjs with spike/vercel.json (headers, no overlapping rules); Deployed: all header checks PASS on the live URL via check-deployed.mjs (engine.json no-cache, hashed WASM immutable + application/wasm, worker CSP on every /engine file, one CSP header per response). HSTS on .vercel.app: max-age=63072000; includeSubDomains; preload (added by Vercel, not by us). Owner to confirm and tick
- [ ] AC0.5 CI Postgres service container `SELECT 1` — owner. Workflow + conformance/ test written; the test compiles, vets and skips without a database. NOT run against Postgres (Docker daemon was not running; CI never run)
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
- [x] AC3.1 SI column equals expected.json (TestMatrixSI); lost-update@SI aborts T2 with abort_concurrent_update at its resumed PUT, final = 150
- [x] AC3.2 P1–P5 at SI over 20,000 random schedules pass (also RU: P1,P2; RC: P1–P3); P7 guards: 2,660 non-serializable SI histories, 1,451 RC schedules with a non-repeatable read, per 20,000

## P4 — SSI and oracle
- [x] AC4.1 Full 32-cell matrix equals expected.json (TestMatrixFull); write-skew and read-only-anomaly walk-throughs reproduce edges, victim, step and clocks (TestWriteSkewSERWalkthrough, TestReadOnlyAnomalySERWalkthrough)
- [x] AC4.2 P6: 20,000 SER schedules in the default test run (0 oracle rejections); 200,000 run locally on 2026-10-20, seeds 1,000,000-1,199,999, 374.5 s, 0 oracle rejections (AZOO_PROP_N=200000 AZOO_PROP_SEED=1000000 go test -run TestPropertiesSER ./engine/run)
- [x] AC4.3 Mutation checks (TestMutationChecks): rules 1, 2, 3 caught by random/canned and shrunk to 8 steps; commit-time check and after-commit re-check are redundant for serializability so they are caught by targeted tests, see DECISIONS.md
- [x] AC4.4 Oracle unit tests: write skew, read-only anomaly, lost update rejected; serial, empty, delete/absent accepted; shrinker test

## P4 follow-ups (owner conditions, 2026-10-20)
- [x] Unsampled check: schema validation + digest recomputation + second-run stability on EVERY schedule for 2,000 seeds x 4 levels (`TestEverySchedulePassesSchemaAndDigest`)
- [x] All five mutations switchable (`ssi.Faults`); both defense-in-depth rules fail a targeted test when switched off (`TestMutationChecks`)
- [x] 200,000-schedule SER campaign with the commit-time check disabled (seeds 1,000,000-1,199,999, 403 s): **0 non-serializable histories**
- [x] 200,000-schedule SER campaign with the after-commit re-check disabled (same seeds, 403 s): **0 non-serializable histories**. Both results support the claim that each rule is redundant for serializability; they do not show the rules are useless (the after-commit re-check changes *when* a doomed transaction aborts)

## P5 — CLI, traces, WASM
- [x] AC5.1 `azoo matrix scenarios --check` passes ("OK: 8 scenarios x 4 levels"); every trace < 20 KB (largest 5.3 KB); matrix.json 3,090 B (< 10 KB); manifest.json 11,300 B
- [x] AC5.2 Native and WASM digests identical for all 32 canned traces under Node v22.16.0 (`node scripts/wasm-digest-check.mjs`: "DIGESTS EQUAL: 32/32"), plus 400/400 on 100 random schedules x 4 levels; the check was shown to fail (exit 1) on a tampered digest
- [x] AC5.3 `worker.js` returns structured `{ok:false, errors:[{line,col,message}]}` for invalid source, oversize source, bad level, and rejects unknown methods; `client.mjs` rejects after 2000 ms, terminates the worker and spawns a fresh one for the next call (stub that never answers; measured wait 2.0 s); after load the worker has no `fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource`/`importScripts` and only ever requested its three own files
- [x] AC5.4 `TestBuildIsReproducible`: two builds, the second with an empty GOCACHE, identical SHA-256 (superseded: the first build stamped the commit hash and was not commit-independent, fixed with -buildvcs=false, now `2249ad7f...024e`, see DECISIONS.md); `go run ./tools/buildwasm -verify` reproduces the committed hash
- WASM size (real engine): raw 5,170,206 B, gzip 1,428,460 B. Under the 1.5 MB gate, OVER the 1.0 MB target; see DECISIONS.md
- Worst-case trace: 3,341,036 B with full per-event store, 288,091 B after the delta change (limit 1 MiB)
- Lint: `gofmt -l` clean, `go vet ./...` clean, staticcheck v0.8.2 clean, `go test -race -short ./...` passes (gcc present). Full `go test ./...` (20,000 schedules per level) passes. NOT run: govulncheck, CI, Playwright

## P6 — Web: map and anomaly pages (`web/`)
Measured 2026-10-20 on Windows 11, Node 22.16.0, Chrome/Firefox/WebKit from Playwright 1.63.0, tree = this commit. Spike untouched. Not yet verified on Vercel (the owner switches the Root Directory after review). **CI (Linux, run 39481116318, 2026-10-20): all four jobs green: go 4m01s, conformance 35s, web 33s (lint, typecheck, 65 unit tests, build with 12 pages and CSP verification, size gate, 
pm audit --omit=dev 0 vulnerabilities), e2e 5m44s (194 Playwright tests passed, 16 intentionally skipped, 0 failed, 0 flaky; Lighthouse; deployed-URL checker).** It took two fix rounds after the first red run; see DECISIONS.md 2026-10-21.
- [x] AC6.1 Every route builds statically: `/`, `/anomalies/[slug]` x 8, `/about`, `/404`, `sitemap.xml`, `robots.txt` (12 HTML files). Map, banners and verdicts are generated from traces (`lib/outcomes.ts`); the no-hard-coded-outcome rule is an ESLint rule plus two unit tests (source scan; ESLint run on snippets) and the 32 manifest cells equal `scenarios/expected.json`. Unit tests: **65 passed in 9 files** (`npm test`: outcomes, replay, explain/reason codes vs the Go list, URL state, step controller, home-data budget, contrast tokens, lint rules, component rendering). `npm run lint` and `npm run typecheck` clean.
- [x] AC6.2 J1/J2 e2e and the keyboard-only walk-through pass in three browsers: **194 passed, 0 failed, 0 flaky** locally and on Linux CI (Chromium 70, Firefox 62, WebKit 62; the 8 skipped in each non-Chromium browser are the Chromium-only axe state scans; 9 of the tests are the repeated-navigation load-event check). WebKit caveat: this build does not Tab to links, so link steps use direct focus there (see DECISIONS.md).
- [x] AC6.3 320 px to 1440 px (9 widths x 4 pages: no horizontal overflow), 200 % and 400 % zoom (640 and 320 px viewports), phone cards vs desktop table, swimlanes vs chronological list, touch targets >= 44 px on all buttons/radios/links at 375 and 1280 px, `prefers-reduced-motion` (transitions and animations 0 under reduce; <= 200 ms otherwise), light and dark (system preference and manual toggle), contrast tokens >= 4.5:1 text and >= 3:1 borders/focus (unit-tested from the real CSS; the test caught a 4.37:1 green and it was darkened).
- [x] AC6.4 axe (WCAG 2.0/2.1/2.2 A and AA + best-practice tags): **203 scans, zero violations at any severity**: every route + the 404 in light and dark in all three browsers (25 per browser), plus in Chromium every anomaly at every level, mid-run and at the end, in both themes (128 scans, which covers blocked, aborted, skipped, queued and resumed cards), plus a phone-size scan with the store drawer open. Lighthouse (mobile profile, median of 3, compressed local server): `/` performance 1.00, accessibility 1.00, best-practices 1.00, SEO 1.00, FCP 0.8 s, LCP 1.9 s, TBT 50 ms, CLS 0, 142 KB transferred; `/anomalies/write-skew` 0.99 / 1.00 / 1.00 / 1.00, LCP 1.9 s, 150 KB. Size gate: first-load JS on `/` 132.1 KB gzip (budget 150; excludes the 38.6 KB `noModule` polyfill chunk, see DECISIONS.md), largest trace 5.1 KB (budget 20), `matrix.json` 3,090 B (budget 10 KB), engine WASM 1,420,852 B gzip (gate 1.5 MB). CSP smoke: `verify-csp` OK on 12 pages / 56 hashes; e2e fails on any console error or CSP violation on every route and while using the viewer, in three browsers; negative control (an unhashed inline script and an inline handler are blocked and reported) passes in all three. `check-deployed.mjs` against the local server with the real headers: PASS (10 pages, 48 inline scripts, 404 page, headers on `/`, an anomaly page and every `/engine/*` file, compression).
- AC0.2 evidence for Firefox and WebKit (the worker + WASM half, which P6 pages deliberately do not exercise): the spike page run in all three engines against `spike/vercel.json` headers: Chromium, Firefox and WebKit each `status: OK`, WASM digest equal to the golden digest, 0 CSP violations, 0 console or request problems. Local, not Vercel; the Vercel run of Chrome/Edge is recorded under P0. Owner still ticks AC0.2.
- NOT done / not verified: deployment of `web/` to Vercel (owner), CI results for the new `web` and `e2e` jobs (see below once run), Safari on macOS and real devices, a screen-reader pass by a human (axe and keyboard tests only), `/playground`, `/og/[slug]`, P7 and later. Copy that is mine, not the spec's: docs/COPY-TODO.md.

## P7–P10
See spec §12.