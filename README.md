# Anomaly Zoo

Watch database isolation bugs happen. Then turn them off.

Anomaly Zoo is a from-scratch MVCC engine in Go (standard library only) that runs scripted schedules of two or three transactions at four isolation levels and records every step. You step through a schedule in your browser, watch a bug happen (a dirty read, a lost update, write skew), switch the level, and see the mechanism that prevents it.

<p align="center">
  <img src="docs/launch/hero.gif" alt="Write skew at Snapshot Isolation leaves zero doctors on call; at Serializable the second transaction is aborted and the invariant holds" width="720"><br>
  <sub>Write skew, Snapshot Isolation then Serializable (24 s). <a href="docs/launch/hero.mp4">MP4 version</a>. The clip is a recording of the site, with captions added by <a href="web/scripts/record-launch.mjs">the recording script</a>.</sub>
</p>

**Site:** https://anomaly-zoo.vercel.app (runs entirely in your browser; static pages, no backend, no cookies, no analytics, no third-party requests).

## The habitat map

Eight anomalies by four isolation levels. Every cell is computed by running the engine, and CI asserts the whole matrix against [`scenarios/expected.json`](scenarios/expected.json); no outcome is written by hand anywhere in the web app.

<img src="docs/launch/habitat-map.png" alt="The habitat map: eight anomalies in rows, four isolation levels in columns, each cell marked Occurs or Prevented" width="900">

## Run it

Requirements: Go (the version in `go.mod`), and Node 22 for the website and the browser-side checks. No other tools are needed; `make` is optional (Windows users can ignore it, every target is one plain command).

| What | With make | Plain command (PowerShell and bash) |
|---|---|---|
| Check the anomaly matrix | `make matrix` | `go run ./cmd/azoo matrix scenarios --check` |
| Run one scenario | | `go run ./cmd/azoo run scenarios/write-skew.azs --level SI` |
| Go tests | `make test` | `go vet ./... ; go test ./...` |
| Build the WebAssembly engine | `make wasm` | `go run ./tools/buildwasm` |
| Website: install, build, serve | `make web` | `cd web; npm ci --ignore-scripts; npm run build; npm run serve` |
| Website end-to-end tests | `make e2e` | `cd web; npx playwright install chromium firefox webkit; npx playwright test` |
| Claims, URL and security checks | `make checks` | `node scripts/check-claims.mjs; node scripts/site-url.mjs --check; node scripts/verify-hardening.mjs` |
| PostgreSQL comparison (needs a PostgreSQL 16 server) | `make conformance` | bash: `export CONFORMANCE_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable`; PowerShell: `$env:CONFORMANCE_DATABASE_URL='postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable'`; then `cd conformance; go run ./cmd/azoo-conformance -random 500` |

More commands, including fuzzing and coverage, are in [docs/DEV.md](docs/DEV.md).

## How it is verified

Each figure below links to where it is recorded. The method is in [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

- **Oracle.** The engine's Serializable level was checked against a serializability oracle on 20,000 random schedules per level in every test run, and on 200,000 Serializable schedules in one local run: 0 histories rejected ([PROGRESS.md, AC4.2](docs/PROGRESS.md)). Passing random schedules against an oracle is evidence, not a proof that the level is correct. Deliberately switching off any of the three edge-creation rules of the Serializable level makes tests fail ([mutation checks](docs/METHODOLOGY.md#mutation-checks)).
- **PostgreSQL.** Outcomes were compared with PostgreSQL 16.15 on the 8 canned scenarios and 10,000 random schedules per level at Read Committed, Snapshot Isolation (PostgreSQL's Repeatable Read) and Serializable. The headline sample is one nightly run (GitHub Actions run 39734736774, commit cb07402, 2026-10-22), recorded in [conformance-10k.json](web/public/conformance-10k.json); method in [METHODOLOGY](docs/METHODOLOGY.md). Statement results, final state and aborted transactions were identical on 8,294 of 8,623 compared schedules at Read Committed (about 96.2%) and 8,882 of 8,979 at Snapshot Isolation (about 98.9%) [source: conformance-10k.json]. "About" because PostgreSQL's own result varies when several statements wait on the same lock: runs #1 and #2 on identical seeds differed by 0.3 points at Read Committed. The schedules where no two statements were blocked at the same time were identical on 6,831 of 6,831 and 7,064 of 7,064, but that is a subset chosen after the fact to explain the differences, not an independent result [source: conformance-10k.json]. At Serializable both sides produced serializable histories in 10,000 of 10,000 schedules, with the same set of aborted transactions in about 93.0% [source: conformance-10k.json]. PR-gate sample, run by CI on every push: 500 random schedules per level, 415 of 434 identical at Read Committed (95.6%) and 441 of 446 at Snapshot Isolation (98.9%) [source: conformance.json](web/public/conformance.json).
- **Differences are documented**, not hidden: there are 8, each with a minimal schedule under [`engine/testdata/regressions/`](engine/testdata/regressions/), and three of them are listed as "cause not yet established" ([METHODOLOGY, Divergences](docs/METHODOLOGY.md#divergences)).
- **Reproducible engine build.** The WebAssembly engine is committed and CI rebuilds it from source and compares the hash; its trace digests equal the native ones on all 32 canned traces ([PROGRESS.md, P5](docs/PROGRESS.md)).
- **Security checks** run in CI: vulnerability scans of both Go modules and the npm dependencies, a repository-controls check, CodeQL ([docs/SECURITY-CONTROLS.md](docs/SECURITY-CONTROLS.md)).

## Limitations

1. A key-to-integer model with prefix scans; no SQL, indexes or durability.
2. A deterministic single-threaded simulation of interleavings, not real concurrency.
3. Read Uncommitted is included for teaching. PostgreSQL has no read-uncommitted: asked for it on the dirty-read schedule it showed no dirty read and the same history as Read Committed ([conformance.json](web/public/conformance.json)).
4. The Serializable level is simplified: predicate locks are key-prefix only and there is no read-only optimisation. On the 10,000 Serializable schedules compared, it aborted more transactions than PostgreSQL in 56 and fewer in 464 ([conformance-10k.json](web/public/conformance-10k.json)); the causes are in [METHODOLOGY](docs/METHODOLOGY.md#divergences).
5. Vendor behaviours differ; this explains concepts and does not replace your database's documentation. Only PostgreSQL 16 was compared, on schedules without DELETE.

Browser testing is automated (Chromium, Firefox and WebKit through Playwright). Safari on macOS, real phones and a human screen-reader pass have not been done.

## More

- [Changelog](CHANGELOG.md) · [Release checklist](docs/RELEASE-CHECKLIST.md) · [Decisions log](docs/DECISIONS.md) · [Progress and recorded runs](docs/PROGRESS.md) · [The full plan](spec.md)
- Security: see [SECURITY.md](SECURITY.md) (private vulnerability reporting) and [docs/SECURITY-CONTROLS.md](docs/SECURITY-CONTROLS.md).
- Third-party code and licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

MIT, see [LICENSE](LICENSE).
