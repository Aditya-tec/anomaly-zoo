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
