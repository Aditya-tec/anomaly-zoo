package run

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/gen"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

// FuzzRun (spec §9.5): for any input that parses, running all four levels
// terminates, never panics, emits a schema-valid trace, gives the same digest
// on a second run, and satisfies the engine's own consistency checks (the same
// Check the property tests apply to every generated schedule).
func FuzzRun(f *testing.F) {
	files, _ := filepath.Glob("../../scenarios/*.azs")
	files2, _ := filepath.Glob("../testdata/regressions/*.azs")
	for _, p := range append(files, files2...) {
		if b, err := os.ReadFile(p); err == nil {
			f.Add(string(b))
		}
	}
	for seed := uint64(1); seed <= 12; seed++ {
		f.Add(dsl.Format(gen.Generate(seed, gen.Config{})))
	}
	f.Fuzz(func(t *testing.T, src string) {
		sc, errs := dsl.Parse(src)
		if sc == nil {
			if len(errs) == 0 {
				t.Fatal("Parse returned neither a scenario nor errors")
			}
			return
		}
		for _, lv := range trace.Levels {
			tr, m, err := Exec(sc, lv)
			if err != nil {
				t.Fatalf("%s: %v", lv, err)
			}
			b, err := tr.Marshal()
			if err != nil {
				t.Fatalf("%s: marshal: %v", lv, err)
			}
			if err := trace.ValidateJSON(b); err != nil {
				t.Fatalf("%s: trace is not schema-valid: %v", lv, err)
			}
			tr2, err := Run(sc, lv)
			if err != nil || tr2.Digest != tr.Digest {
				t.Fatalf("%s: digest differs on a second run (%v)", lv, err)
			}
			if err := Check(lv, tr, m); err != nil {
				t.Fatalf("%s: %v", lv, err)
			}
		}
	})
}
