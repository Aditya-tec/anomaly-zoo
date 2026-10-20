package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const repoRoot = "../.."

// TestBuildIsReproducible builds the WASM twice into different directories
// and requires identical SHA-256 (spec §11.3, AC5.4). The second build uses an
// empty Go build cache so it really recompiles the standard library and the
// engine instead of reusing the first build's objects.
func TestBuildIsReproducible(t *testing.T) {
	a, err := BuildWasm(repoRoot, filepath.Join(t.TempDir(), "a.wasm"))
	if err != nil {
		t.Fatal(err)
	}
	b, err := BuildWasm(repoRoot, filepath.Join(t.TempDir(), "b.wasm"), "GOCACHE="+t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	// Go must not stamp the commit into the binary (that would make the hash
	// change with every commit and with a dirty working tree).
	if bytes.Contains(a, []byte("anomaly-zoo\tv0.0.0-")) || bytes.Contains(a, []byte("vcs.revision")) {
		t.Fatal("binary embeds VCS stamping; -buildvcs=false is missing")
	}
	if sum(a) != sum(b) {
		t.Fatalf("two builds differ: %s vs %s", sum(a), sum(b))
	}
	t.Logf("wasm sha256 %s, raw %d B, gzip %d B", sum(a), len(a), gzipSize(a))
}

// TestCommittedEngineMatchesSource rebuilds from source and compares with the
// committed engine.json and WASM file, so a stale or tampered binary fails CI.
func TestCommittedEngineMatchesSource(t *testing.T) {
	dir := filepath.Join(repoRoot, "web", "public", "engine")
	raw, err := os.ReadFile(filepath.Join(dir, "engine.json"))
	if err != nil {
		t.Fatal(err)
	}
	var eng Engine
	if err := json.Unmarshal(raw, &eng); err != nil {
		t.Fatal(err)
	}
	committed, err := os.ReadFile(filepath.Join(dir, eng.Wasm))
	if err != nil {
		t.Fatal(err)
	}
	if sum(committed) != eng.WasmSHA256 {
		t.Fatalf("%s does not match wasmSha256 in engine.json", eng.Wasm)
	}
	if !strings.Contains(eng.Wasm, eng.WasmSHA256[:8]) {
		t.Fatalf("file name %s does not carry the hash prefix", eng.Wasm)
	}
	rebuilt, err := BuildWasm(repoRoot, filepath.Join(t.TempDir(), "r.wasm"))
	if err != nil {
		t.Fatal(err)
	}
	if sum(rebuilt) != eng.WasmSHA256 {
		t.Fatalf("rebuild %s != committed %s (committed with %s); run `go run ./tools/buildwasm`", sum(rebuilt), eng.WasmSHA256, eng.GoVersion)
	}
	if gz := gzipSize(committed); gz > 1_500_000 {
		t.Fatalf("WASM is %d B gzip, over the 1.5 MB gate", gz)
	}
	exec, err := os.ReadFile(filepath.Join(dir, eng.WasmExec))
	if err != nil {
		t.Fatal(err)
	}
	if sum(exec) != eng.WasmExecSHA256 {
		t.Fatal("wasm_exec.js does not match engine.json")
	}
	src, err := WasmExecPath(repoRoot)
	if err != nil {
		t.Fatal(err)
	}
	want, _ := os.ReadFile(src)
	if sum(want) != eng.WasmExecSHA256 {
		t.Fatalf("committed wasm_exec.js differs from the toolchain's %s", src)
	}
}
