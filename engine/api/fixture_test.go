package api

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/gen"
	"github.com/Aditya-tec/anomaly-zoo/engine/run"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

var update = flag.Bool("update", false, "rewrite scripts/fixtures/random-digests.json")

type digestFixture struct {
	Sources map[string]string `json:"sources"`
	Digests map[string]string `json:"digests"`
}

// TestRandomDigestFixture keeps scripts/fixtures/random-digests.json (100 random
// schedules x 4 levels, native digests) current. scripts/engine.test.mjs checks
// that the WASM build produces the same digests under Node.
func TestRandomDigestFixture(t *testing.T) {
	fx := digestFixture{Sources: map[string]string{}, Digests: map[string]string{}}
	for seed := uint64(1); seed <= 100; seed++ {
		sc := gen.Generate(seed, gen.Config{})
		key := fmt.Sprint(seed)
		fx.Sources[key] = dsl.Format(sc)
		for _, lv := range trace.Levels {
			// Run the formatted source, exactly what the browser would parse.
			parsed, errs := dsl.Parse(fx.Sources[key])
			if len(errs) > 0 {
				t.Fatal(errs)
			}
			tr, err := run.Run(parsed, lv)
			if err != nil {
				t.Fatal(err)
			}
			fx.Digests[key+"@"+string(lv)] = tr.Digest
		}
	}
	want, err := trace.CanonicalJSON(fx)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join("..", "..", "scripts", "fixtures", "random-digests.json")
	if *update {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, want, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("missing fixture (run with -update): %v", err)
	}
	if !bytes.Equal(got, want) {
		var g digestFixture
		_ = json.Unmarshal(got, &g)
		t.Fatalf("fixture is stale; review and re-run with -update")
	}
}
