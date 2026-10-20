# Thin wrappers over plain go/node commands; see docs/DEV.md for the raw commands.
.PHONY: test matrix traces wasm wasm-verify wasm-check fuzz all

test:
	go vet ./... && go test ./...

matrix:
	go run ./cmd/azoo matrix scenarios --check

traces:
	go run ./cmd/azoo traces --out web/public/traces

wasm:
	go run ./tools/buildwasm

wasm-verify:
	go run ./tools/buildwasm -verify

wasm-check:
	node --test scripts/engine.test.mjs

fuzz:
	go test ./engine/dsl -run '^$$' -fuzz FuzzParse -fuzztime 30s

all: test matrix wasm-check