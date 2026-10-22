package conformance

import (
	"context"
	"os"
	"testing"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

func loadRegression(t *testing.T, name string) *dsl.Scenario {
	t.Helper()
	b, err := os.ReadFile(regressionsDir + "/" + name)
	if err != nil {
		t.Fatal(err)
	}
	sc, errs := dsl.Parse(string(b))
	if len(errs) > 0 {
		t.Fatalf("%s: %v", name, errs)
	}
	return sc
}

// Needs no database: the dangerous structure re-derived from the engine's trace (spec 4.8) is the one
// each regression schedule's story says.
func TestVictimStructures(t *testing.T) {
	want := map[string]Structure{
		"ser-no-writes-in-edge.azs":        {Victim: "T1", Pivot: "T1", In: "T2", Out: "T3"},
		"ser-error-deferred-to-commit.azs": {Victim: "T2", Pivot: "T2", In: "T1", Out: "T1"},
		"ser-pivot-before-in-ends.azs":     {Victim: "T2", Pivot: "T2", In: "T1", Out: "T3"},
	}
	for name, w := range want {
		sc := loadRegression(t, name)
		_, tr, err := RunEngine(sc, trace.SER)
		if err != nil {
			t.Fatal(err)
		}
		got, ok := VictimStructures(tr)[w.Victim]
		if !ok || got != w {
			t.Errorf("%s: structure for %s = %+v (found %v), want %+v", name, w.Victim, got, ok, w)
		}
	}
}

// The control experiments behind four divergences. Each shows that one change to the schedule, and nothing
// else, moves PostgreSQL's answer: that is what makes the cause an observation rather than a guess.
func TestSERControls(t *testing.T) {
	dsn := os.Getenv("CONFORMANCE_DATABASE_URL")
	if dsn == "" {
		if os.Getenv("AZOO_REQUIRE_DB") != "" {
			t.Fatal("AZOO_REQUIRE_DB is set but CONFORMANCE_DATABASE_URL is not")
		}
		t.Skip("CONFORMANCE_DATABASE_URL not set")
	}
	ctx := context.Background()
	r, err := NewRunner(ctx, dsn, "az_serctl")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close(ctx)
	const runs = 10

	// run returns, over runs, how often PostgreSQL differs from the engine and the distinct PostgreSQL abort sets.
	run := func(sc *dsl.Scenario) (differ int, engineAborts string, pgAborts map[string]int) {
		eng, _, err := RunEngine(sc, trace.SER)
		if err != nil {
			t.Fatal(err)
		}
		pgAborts = map[string]int{}
		for i := 0; i < runs; i++ {
			pg, err := r.Run(ctx, sc, trace.SER)
			if err != nil {
				t.Fatal(err)
			}
			if len(pg.Anomalies) > 0 {
				t.Fatalf("harness anomalies: %v", pg.Anomalies)
			}
			if len(Diff(eng, pg)) > 0 {
				differ++
			}
			pgAborts[fmtAborts(pg.SystemAborts())]++
		}
		return differ, fmtAborts(eng.SystemAborts()), pgAborts
	}

	t.Run("page locks (more form): padding makes PostgreSQL agree", func(t *testing.T) {
		sc := loadRegression(t, "ser-page-locks-more.azs")
		if d, _, _ := run(sc); d != runs {
			t.Errorf("without padding PostgreSQL differed in %d of %d runs, want all", d, runs)
		}
		r.Pad = 3000
		defer func() { r.Pad = 0 }()
		if d, _, _ := run(sc); d != 0 {
			t.Errorf("with padding PostgreSQL still differed in %d of %d runs", d, runs)
		}
	})

	t.Run("no writes in the in-edge: one write to T2 makes PostgreSQL agree", func(t *testing.T) {
		sc := loadRegression(t, "ser-no-writes-in-edge.azs")
		d, eng, pg := run(sc)
		if d != runs || eng != "{T1:serialization}" || len(pg) != 1 || pg["{}"] != runs {
			t.Errorf("baseline: differed %d/%d, engine %s, PostgreSQL %v; want engine {T1} and PostgreSQL aborting nobody every time", d, runs, eng, pg)
		}
		v, ok := WithWrite(sc, "T2")
		if !ok {
			t.Fatal("cannot add the write")
		}
		if d, _, pg := run(v); d != 0 {
			t.Errorf("with a write added to T2 PostgreSQL still differed in %d of %d runs (%v)", d, runs, pg)
		}
	})

	t.Run("error deferred to commit: ABORT turned into COMMIT makes PostgreSQL abort the same transaction", func(t *testing.T) {
		sc := loadRegression(t, "ser-error-deferred-to-commit.azs")
		d, eng, pg := run(sc)
		if d != runs || eng != "{T2:serialization}" || pg["{}"] != runs {
			t.Errorf("baseline: differed %d/%d, engine %s, PostgreSQL %v", d, runs, eng, pg)
		}
		v, ok := AbortToCommit(sc, "T2")
		if !ok {
			t.Fatal("cannot turn the ABORT into a COMMIT")
		}
		_, eng, pg = run(v)
		if len(pg) != 1 || pg[eng] != runs {
			t.Errorf("with COMMIT: engine aborts %s, PostgreSQL %v; want the same set every time", eng, pg)
		}
	})

	t.Run("pivot before the in-transaction ends: the observations the divergence records", func(t *testing.T) {
		sc := loadRegression(t, "ser-pivot-before-in-ends.azs")
		d, eng, pg := run(sc)
		if d != runs || eng != "{T2:serialization}" || pg["{}"] != runs {
			t.Errorf("baseline: differed %d/%d, engine %s, PostgreSQL %v; want engine {T2} and PostgreSQL aborting nobody every time", d, runs, eng, pg)
		}
		v, ok := AbortToCommit(sc, "T1")
		if !ok {
			t.Fatal("cannot turn the ABORT into a COMMIT")
		}
		_, eng, pg = run(v)
		if eng != "{T2:serialization}" || len(pg) != 1 || pg["{T1:serialization}"] != runs {
			t.Errorf("with T1 committing: engine %s, PostgreSQL %v; want engine {T2} and PostgreSQL {T1} every time", eng, pg)
		}
	})
}
