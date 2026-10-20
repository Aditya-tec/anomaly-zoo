# Developing without `make` (Windows / PowerShell)

| Task | Command |
|---|---|
| Format check | `gofmt -l .` (must print nothing) |
| Vet | `go vet ./...` |
| Tests | `go test ./...` |
| Race tests | CI only (needs cgo/gcc on Windows): `go test -race -count=1 ./...` |
| Matrix check | `go run ./cmd/azoo matrix scenarios/ --check` |
| Emit traces | `go run ./cmd/azoo traces --out web/public/traces` |
| Fuzz parser | `go test ./engine/dsl -run '^$' -fuzz FuzzParse -fuzztime 5m` |
| Build WASM | `$env:GOOS='js'; $env:GOARCH='wasm'; $env:CGO_ENABLED='0'; go build -trimpath -ldflags="-s -w -buildid=" -o web/public/engine/azoo.wasm ./cmd/wasm` (reset the env vars afterwards) |

Line endings are LF everywhere (`.gitattributes`); digests depend on it.
