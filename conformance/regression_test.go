package conformance

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

const (
	divergencesFile = "divergences.json"
	regressionsDir  = "../engine/testdata/regressions"
	// A divergence must show itself at least once in this many PostgreSQL runs.
	// The ones caused by a race show up in about half of all runs.
	reproduceRuns = 25
)

func loadDivs(t *testing.T) []Divergence {
	t.Helper()
	ds, err := LoadDivergences(divergencesFile, regressionsDir)
	if err != nil {
		t.Fatal(err)
	}
	return ds
}

func levelsOf(d Divergence) []trace.Level {
	var out []trace.Level
	for _, l := range d.Levels {
		out = append(out, trace.Level(l))
	}
	return out
}

// Needs no database: the curated file is well formed and every regression
// schedule parses and runs in the engine at the levels it names.
func TestDivergencesWellFormed(t *testing.T) {
	ds := loadDivs(t)
	if len(ds) == 0 {
		t.Fatal("no divergences recorded; the report would claim there are none")
	}
	seen := map[string]bool{}
	for _, d := range ds {
		if seen[d.ID] {
			t.Errorf("duplicate divergence id %s", d.ID)
		}
		seen[d.ID] = true
		if strings.TrimSpace(d.Title) == "" || strings.TrimSpace(d.Cause) == "" || len(d.Levels) == 0 || len(d.Signatures) == 0 {
			t.Errorf("%s: title, cause, levels and signatures are all required", d.ID)
		}
		if !d.Established && d.Cause != "cause not yet established" {
			t.Errorf("%s: an unestablished cause must read exactly %q", d.ID, "cause not yet established")
		}
		if d.Established && strings.Contains(strings.ToLower(d.Cause), "not yet established") {
			t.Errorf("%s: marked established but the text says otherwise", d.ID)
		}
		sc, errs := dsl.Parse(d.Schedule)
		if len(errs) > 0 {
			t.Errorf("%s: %s does not parse: %v", d.ID, d.Regression, errs)
			continue
		}
		for _, lv := range levelsOf(d) {
			if _, err := RunEngine2(sc, lv); err != nil {
				t.Errorf("%s at %s: %v", d.ID, lv, err)
			}
		}
	}
}

// RunEngine2 is RunEngine without the history conversion, for tests that only
// need to know the engine accepts the schedule.
func RunEngine2(sc *dsl.Scenario, lv trace.Level) (*trace.Trace, error) {
	_, tr, err := RunEngine(sc, lv)
	return tr, err
}

// Every recorded divergence still reproduces: within reproduceRuns runs
// PostgreSQL disagrees with the engine at least once at each named level. If a
// future PostgreSQL stops differing, this fails so the entry gets revisited.
func TestRegressionsReproduce(t *testing.T) {
	dsn := os.Getenv("CONFORMANCE_DATABASE_URL")
	if dsn == "" {
		if os.Getenv("AZOO_REQUIRE_DB") != "" {
			t.Fatal("AZOO_REQUIRE_DB is set but CONFORMANCE_DATABASE_URL is not")
		}
		t.Skip("CONFORMANCE_DATABASE_URL not set")
	}
	ctx := context.Background()
	r, err := NewRunner(ctx, dsn, "az_regress")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close(ctx)
	for _, d := range loadDivs(t) {
		sc, errs := dsl.Parse(d.Schedule)
		if len(errs) > 0 {
			t.Fatalf("%s: %v", d.ID, errs)
		}
		for _, lv := range levelsOf(d) {
			eng, _, err := RunEngine(sc, lv)
			if err != nil {
				t.Fatal(err)
			}
			differing := 0
			for i := 0; i < reproduceRuns; i++ {
				pg, err := r.Run(ctx, sc, lv)
				if err != nil {
					t.Fatal(err)
				}
				if len(pg.Anomalies) > 0 {
					t.Fatalf("%s at %s: harness anomalies %v", d.ID, lv, pg.Anomalies)
				}
				if len(Diff(eng, pg)) > 0 {
					differing++
				}
			}
			t.Logf("%s at %s: PostgreSQL differed from the engine in %d of %d runs", d.ID, lv, differing, reproduceRuns)
			if differing == 0 {
				t.Errorf("%s at %s: PostgreSQL agreed with the engine in all %d runs; the divergence no longer reproduces", d.ID, lv, reproduceRuns)
			}
		}
	}
}
