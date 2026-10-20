# Developing without `make` (Windows / PowerShell)

| Task | Command |
|---|---|
| Format check | `gofmt -l .` (must print nothing) |
| Vet | `go vet ./...` |
| Static analysis | `go install honnef.co/go/tools/cmd/staticcheck@latest` then `staticcheck ./...` |
| Tests | `go test ./...` (property tests: 20,000 schedules per level; `-short` uses 2,000) |
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