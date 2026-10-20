package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

func do(t *testing.T, args ...string) (int, string, string) {
	t.Helper()
	var o, e bytes.Buffer
	code := realMain(args, &o, &e)
	return code, o.String(), e.String()
}

func TestVersion(t *testing.T) {
	code, out, _ := do(t, "version")
	if code != 0 || strings.TrimSpace(out) != trace.EngineVersion {
		t.Fatalf("%d %q", code, out)
	}
}

func TestRunHumanAndJSON(t *testing.T) {
	code, out, errs := do(t, "run", "../../scenarios/write-skew.azs", "--level", "SER")
	if code != 0 || !strings.Contains(out, "abort_dependencies") || !strings.Contains(out, "serializable: yes") {
		t.Fatalf("%d\n%s\n%s", code, out, errs)
	}
	code, out, _ = do(t, "run", "--level", "SI", "--json", "../../scenarios/write-skew.azs")
	if code != 0 || !strings.HasPrefix(out, `{"digest":`) {
		t.Fatalf("%d %q", code, out[:60])
	}
	if err := trace.ValidateJSON([]byte(out)); err != nil {
		t.Fatal(err)
	}
}

func TestRunErrors(t *testing.T) {
	if code, _, _ := do(t, "run", "../../scenarios/write-skew.azs", "--level", "XX"); code != 1 {
		t.Fatal("bad level should fail")
	}
	if code, _, _ := do(t, "run"); code != 1 {
		t.Fatal("missing file should fail")
	}
	bad := filepath.Join(t.TempDir(), "bad.azs")
	os.WriteFile(bad, []byte("scenario x\nschedule:\n  T1 FROB\n"), 0o644)
	code, _, errs := do(t, "run", bad)
	if code != 1 || !strings.Contains(errs, "bad.azs:3:") {
		t.Fatalf("%d %q", code, errs)
	}
	if code, _, _ := do(t, "nope"); code != 2 {
		t.Fatal("unknown command should exit 2")
	}
	if code, _, _ := do(t); code != 2 {
		t.Fatal("no command should exit 2")
	}
}

func TestMatrixCheck(t *testing.T) {
	code, out, errs := do(t, "matrix", "../../scenarios", "--check")
	if code != 0 || !strings.Contains(out, "OK: 8 scenarios x 4 levels") {
		t.Fatalf("%d\n%s\n%s", code, out, errs)
	}
}

func TestMatrixCheckFailsOnDifference(t *testing.T) {
	dir := t.TempDir()
	files, _ := filepath.Glob("../../scenarios/*")
	for _, f := range files {
		b, _ := os.ReadFile(f)
		if filepath.Base(f) == "expected.json" {
			b = bytes.Replace(b, []byte(`"SER": { "invariant": "holds",    "serializable": true,  "aborts": { "T2": "abort_dependencies" }, "mechanism": "abort_dependencies" }`),
				[]byte(`"SER": { "invariant": "violated", "serializable": false, "aborts": {}, "mechanism": "none" }`), 1)
		}
		os.WriteFile(filepath.Join(dir, filepath.Base(f)), b, 0o644)
	}
	code, _, errs := do(t, "matrix", dir, "--check")
	if code != 1 || !strings.Contains(errs, "write-skew/SER") {
		t.Fatalf("%d %q", code, errs)
	}
}

func TestTracesIsDeterministic(t *testing.T) {
	a, b := t.TempDir(), t.TempDir()
	for _, d := range []string{a, b} {
		if code, out, errs := do(t, "traces", "--out", d, "--scenarios", "../../scenarios"); code != 0 {
			t.Fatalf("%s %s", out, errs)
		}
	}
	files, _ := filepath.Glob(filepath.Join(a, "*"))
	if len(files) != 34 { // 32 traces + manifest + matrix
		t.Fatalf("%d files", len(files))
	}
	for _, f := range files {
		x, _ := os.ReadFile(f)
		y, _ := os.ReadFile(filepath.Join(b, filepath.Base(f)))
		if !bytes.Equal(x, y) {
			t.Errorf("%s differs between runs", filepath.Base(f))
		}
		if filepath.Base(f) != "manifest.json" && filepath.Base(f) != "matrix.json" && len(x) > 20*1024 {
			t.Errorf("%s is %d bytes", filepath.Base(f), len(x))
		}
		if bytes.ContainsAny(x, "\r\n") {
			t.Errorf("%s contains a line break", filepath.Base(f))
		}
	}
	mb, _ := os.ReadFile(filepath.Join(a, "matrix.json"))
	if len(mb) > 10*1024 {
		t.Errorf("matrix.json is %d bytes (> 10 KB)", len(mb))
	}
}

// The committed web/public/traces must be exactly what the engine produces.
func TestCommittedTracesAreFresh(t *testing.T) {
	fresh := t.TempDir()
	if code, out, errs := do(t, "traces", "--out", fresh, "--scenarios", "../../scenarios"); code != 0 {
		t.Fatalf("%s %s", out, errs)
	}
	files, _ := filepath.Glob(filepath.Join(fresh, "*"))
	for _, f := range files {
		want, _ := os.ReadFile(f)
		got, err := os.ReadFile(filepath.Join("../../web/public/traces", filepath.Base(f)))
		if err != nil || !bytes.Equal(got, want) {
			t.Errorf("web/public/traces/%s is stale; run `go run ./cmd/azoo traces --out web/public/traces`", filepath.Base(f))
		}
	}
	committed, _ := filepath.Glob("../../web/public/traces/*")
	if len(committed) != len(files) {
		t.Errorf("web/public/traces has %d files, expected %d", len(committed), len(files))
	}
}

func TestGen(t *testing.T) {
	for _, lv := range []string{"RU", "RC", "SI", "SER"} {
		code, out, errs := do(t, "gen", "--seed", "7", "--count", "200", "--level", lv, "--txns", "3", "--keys", "4")
		if code != 0 || !strings.Contains(out, "OK: 200 schedules") {
			t.Fatalf("%s: %d\n%s\n%s", lv, code, out, errs)
		}
	}
	if code, _, _ := do(t, "gen", "--level", "ZZ"); code != 1 {
		t.Fatal("bad level should fail")
	}
}
