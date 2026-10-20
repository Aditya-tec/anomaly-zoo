# Thin wrappers over plain go commands; see docs/DEV.md for the raw commands.
.PHONY: test matrix traces wasm fuzz all

test:
	go vet ./... && go test ./...

matrix:
	go run ./cmd/azoo matrix scenarios/ --check

traces:
	go run ./cmd/azoo traces --out web/public/traces

wasm:
	CGO_ENABLED=0 GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w -buildid=" -o web/public/engine/azoo.wasm ./cmd/wasm

fuzz:
	go test ./engine/dsl -run '^$$' -fuzz FuzzParse -fuzztime 30s

all: test matrix
