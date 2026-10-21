# Thin wrappers over plain go/node commands; see docs/DEV.md for the raw commands (they work
# without make, which is how development on Windows is done).
.PHONY: test matrix traces wasm wasm-verify wasm-check fuzz web e2e checks conformance all

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
	go test ./engine/dsl -run '^$$' -fuzz '^FuzzParse$$' -fuzztime 30s
	go test ./engine/run -run '^$$' -fuzz '^FuzzRun$$' -fuzztime 30s

# Website: install, build (static export, CSP injection and checks), serve on :4173.
web:
	cd web && npm ci --ignore-scripts && npm run build && npm run serve

# Playwright in Chromium, Firefox and WebKit, with axe (needs a build: make web builds it).
e2e:
	cd web && npx playwright install chromium firefox webkit && npm run build && npx playwright test

# Claims policy, production-URL consistency, repository controls, notices freshness.
checks:
	node scripts/check-claims.mjs
	node --test scripts/check-claims.test.mjs
	node scripts/site-url.mjs --check
	node scripts/verify-hardening.mjs
	node scripts/gen-third-party-notices.mjs --check

# Needs a PostgreSQL 16 server: set CONFORMANCE_DATABASE_URL first (see README).
conformance:
	cd conformance && go run ./cmd/azoo-conformance -random 500 -out ../web/public/conformance.json

all: test matrix wasm-check
