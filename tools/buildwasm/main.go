// Command buildwasm builds the reproducible engine WASM (spec §11.3):
//
//	CGO_ENABLED=0 GOOS=js GOARCH=wasm go build -trimpath \
//	    -ldflags="-s -w -buildid=" -mod=readonly ./cmd/wasm
//
// It writes <out>/azoo.<hash8>.wasm, copies wasm_exec.js from the same Go
// toolchain's GOROOT and writes <out>/engine.json. With -verify it rebuilds
// into a temporary directory and fails if the hash differs from engine.json.
package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Engine is the content of engine.json.
type Engine struct {
	EngineVersion  string `json:"engineVersion"`
	GoVersion      string `json:"goVersion"`
	Wasm           string `json:"wasm"`
	WasmSHA256     string `json:"wasmSha256"`
	WasmExec       string `json:"wasmExec"`
	WasmExecSHA256 string `json:"wasmExecSha256"`
}

// BuildWasm compiles ./cmd/wasm from repoRoot to dst and returns the bytes.
// extraEnv (for example GOCACHE=...) is appended to the build environment.
func BuildWasm(repoRoot, dst string, extraEnv ...string) ([]byte, error) {
	cmd := exec.Command("go", "build", "-mod=readonly", "-trimpath", "-ldflags=-s -w -buildid=", "-o", dst, "./cmd/wasm")
	cmd.Dir = repoRoot
	cmd.Env = append(os.Environ(), "CGO_ENABLED=0", "GOOS=js", "GOARCH=wasm", "GOFLAGS=-mod=readonly")
	cmd.Env = append(cmd.Env, extraEnv...)
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("go build: %v\n%s", err, out)
	}
	return os.ReadFile(dst)
}

func goEnv(root, key string) (string, error) {
	cmd := exec.Command("go", "env", key)
	cmd.Dir = root
	out, err := cmd.Output()
	return strings.TrimSpace(string(out)), err
}

// WasmExecPath finds wasm_exec.js in the toolchain's GOROOT (lib/wasm since
// Go 1.24, misc/wasm before).
func WasmExecPath(root string) (string, error) {
	goroot, err := goEnv(root, "GOROOT")
	if err != nil {
		return "", err
	}
	for _, rel := range []string{"lib/wasm/wasm_exec.js", "misc/wasm/wasm_exec.js"} {
		p := filepath.Join(goroot, filepath.FromSlash(rel))
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("wasm_exec.js not found under %s", goroot)
}

func sum(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }

func gzipSize(b []byte) int {
	var buf bytes.Buffer
	w, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	w.Write(b)
	w.Close()
	return buf.Len()
}

func main() {
	root := flag.String("root", ".", "repository root")
	out := flag.String("out", "web/public/engine", "output directory (relative to root)")
	verify := flag.Bool("verify", false, "rebuild and compare with the committed engine.json")
	engineVersion := flag.String("engine-version", "1.0.0", "engine version recorded in engine.json")
	flag.Parse()
	if err := run(*root, *out, *verify, *engineVersion); err != nil {
		fmt.Fprintln(os.Stderr, "buildwasm:", err)
		os.Exit(1)
	}
}

func run(root, outDir string, verify bool, engineVersion string) error {
	outAbs := filepath.Join(root, outDir)
	tmp, err := os.MkdirTemp("", "azoo-wasm-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	wasm, err := BuildWasm(root, filepath.Join(tmp, "azoo.wasm"))
	if err != nil {
		return err
	}
	hash := sum(wasm)
	goVer, err := goEnv(root, "GOVERSION")
	if err != nil {
		return err
	}
	fmt.Printf("wasm: raw %d B, gzip %d B, sha256 %s\n", len(wasm), gzipSize(wasm), hash)

	if verify {
		b, err := os.ReadFile(filepath.Join(outAbs, "engine.json"))
		if err != nil {
			return err
		}
		var committed Engine
		if err := json.Unmarshal(b, &committed); err != nil {
			return err
		}
		if committed.WasmSHA256 != hash {
			return fmt.Errorf("rebuild hash %s differs from committed %s (Go %s vs %s)", hash, committed.WasmSHA256, goVer, committed.GoVersion)
		}
		fmt.Println("verify: rebuild reproduces the committed WASM hash")
		return nil
	}

	execSrc, err := WasmExecPath(root)
	if err != nil {
		return err
	}
	execBytes, err := os.ReadFile(execSrc)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(outAbs, 0o755); err != nil {
		return err
	}
	old, _ := filepath.Glob(filepath.Join(outAbs, "azoo.*.wasm"))
	for _, f := range old {
		os.Remove(f)
	}
	name := "azoo." + hash[:8] + ".wasm"
	if err := os.WriteFile(filepath.Join(outAbs, name), wasm, 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(outAbs, "wasm_exec.js"), execBytes, 0o644); err != nil {
		return err
	}
	eng := Engine{EngineVersion: engineVersion, GoVersion: goVer, Wasm: name, WasmSHA256: hash, WasmExec: "wasm_exec.js", WasmExecSHA256: sum(execBytes)}
	eb, err := json.MarshalIndent(eng, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(outAbs, "engine.json"), append(eb, '\n'), 0o644); err != nil {
		return err
	}
	fmt.Printf("wrote %s, wasm_exec.js (from %s) and engine.json in %s\n", name, execSrc, outAbs)
	return nil
}
