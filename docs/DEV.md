# Developing without `make` (Windows / PowerShell)

| Task | Command |
|---|---|
| Format check | `gofmt -l .` (must print nothing) |
| Vet | `go vet ./...` |
| Static analysis | `go install honnef.co/go/tools/cmd/staticcheck@latest` then `staticcheck ./...` |
| Tests | `go test ./...` (property tests: 20,000 schedules per level; `-short` uses 1,000, and 200 seeds in the unsampled schema/digest test) |
| Race tests | `go test -race -count=1 ./...` (needs gcc; also run in CI) |
| Long property run | `$env:AZOO_PROP_N='200000'; $env:AZOO_PROP_SEED='1000000'; go test -run 'TestPropertiesSER$' -timeout 60m ./engine/run` |
| Fault campaign | same, plus `$env:AZOO_SSI_FAULT='NoCommitCheck'` or `'NoAfterCommit'` (P6 is then only counted, not asserted) |
| Matrix check | `go run ./cmd/azoo matrix scenarios --check` |
| Run one scenario | `go run ./cmd/azoo run scenarios/write-skew.azs --level SER` |
| Random schedules | `go run ./cmd/azoo gen --seed 1 --count 5000 --level SER` |
| Emit traces | `go run ./cmd/azoo traces --out web/public/traces` |
| Update golden traces | `go test ./engine/run -run TestGolden -update` (review the diff first) |
| Update random-digest fixture | `go test ./engine/api -run TestRandomDigestFixture -update` |
| Build WASM | `go run ./tools/buildwasm` (writes web/public/engine/azoo.<hash8>.wasm, wasm_exec.js, engine.json) |
| Verify WASM reproduces | `go run ./tools/buildwasm -verify` |
| Node checks (client timeout, worker.js, native-vs-WASM digests) | `node --test scripts/engine.test.mjs` |
| Digest check only | `node scripts/wasm-digest-check.mjs` |
| Fuzz parser | `go test ./engine/dsl -run '^$' -fuzz FuzzParse -fuzztime 5m` |

Line endings are LF everywhere (`.gitattributes`); digests depend on it.

## Website (`web/`)

Run from `web/` after `npm ci --ignore-scripts`:

| Task | Command |
|---|---|
| Lint (includes the no-hard-coded-outcome and no-innerHTML rules) | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Unit tests | `npm test` |
| Build (static export to `out/`, CSP injection + verification, no-engine check) | `npm run build` |
| Size budgets | `npm run size` |
| Serve `out/` with the real headers and compression | `npm run serve` (port 4173) |
| e2e + axe in Chromium, Firefox, WebKit (first time: `npx playwright install chromium firefox webkit`) | `npm run e2e` |
| Lighthouse (mobile; set `CHROME_PATH` if Chrome is not found) | `npm run lighthouse` |
| Check a running or deployed URL (CSP + headers on every page) | `node scripts/check-deployed.mjs https://<host>` |
| Regenerate the 1200x630 share images (needs a built site and Chromium); a unit test fails if they are stale | `npm run build; npm run og` |
| Refresh the traces the site reads | `go run ./cmd/azoo traces --out web/public/traces` (a Go test fails if they are stale) |
## Hardening (P9)

| Task | Command |
|---|---|
| Repository controls (pinned Actions, permissions, headers, policy files, ...) | `node scripts/verify-hardening.mjs` |
| Regenerate / check the third-party notices (after `npm ci` in `web/`) | `node scripts/gen-third-party-notices.mjs` / `--check` |
| Regenerate / check the timeline grid classes | `node scripts/gen-grid-css.mjs` / `--check` (run from `web/`) |
| Vulnerability scans | `go install golang.org/x/vuln/cmd/govulncheck@v1.9.0`, then `govulncheck ./...` (also in `conformance/`); `npm audit --omit=dev --audit-level=high` in `web/` |
| Engine coverage | `go test -short -coverprofile=c.out -coverpkg=./engine/... ./engine/...` then `go tool cover -func=c.out` (last line; the gate is 85 %) |
| Fuzz | `go test -run '^$' -fuzz '^FuzzParse$' -fuzztime 5m ./engine/dsl` and `go test -run '^$' -fuzz '^FuzzRun$' -fuzztime 5m ./engine/run` |
| Lint the workflows | `go install github.com/rhysd/actionlint/cmd/actionlint@latest`, then `actionlint .github/workflows/*.yml` |
