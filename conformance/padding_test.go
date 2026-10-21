package conformance

import (
	"context"
	"os"
	"testing"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

// padRows is enough filler between two keys that they cannot share a B-tree
// leaf page (a page holds a few hundred of these short keys).
const padRows = 3000

// TestPageGranularityControl is the control experiment behind the SER
// divergences. If PostgreSQL's disagreement is caused by its predicate locks
// being per index page, it must go away when the keys involved are moved onto
// different pages, without changing anything about the schedule. The two
// schedules whose reads are point reads (no filler may sit inside a scanned
// prefix) are run unpadded (they differ) and padded (they must agree).
func TestPageGranularityControl(t *testing.T) {
	dsn := os.Getenv("CONFORMANCE_DATABASE_URL")
	if dsn == "" {
		if os.Getenv("AZOO_REQUIRE_DB") != "" {
			t.Fatal("AZOO_REQUIRE_DB is set but CONFORMANCE_DATABASE_URL is not")
		}
		t.Skip("CONFORMANCE_DATABASE_URL not set")
	}
	ctx := context.Background()
	r, err := NewRunner(ctx, dsn, "az_pad")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close(ctx)
	byRegression := map[string]Divergence{}
	for _, d := range loadDivs(t) {
		byRegression[d.Regression] = d
	}
	for _, name := range []string{"ser-disjoint-keys.azs", "ser-different-victim.azs"} {
		d, ok := byRegression[name]
		if !ok {
			t.Fatalf("%s is not recorded as a divergence", name)
		}
		sc, errs := dsl.Parse(d.Schedule)
		if len(errs) > 0 {
			t.Fatal(errs)
		}
		eng, _, err := RunEngine(sc, trace.SER)
		if err != nil {
			t.Fatal(err)
		}
		for _, pad := range []int{0, padRows} {
			r.Pad = pad
			differ := 0
			const runs = 10
			for i := 0; i < runs; i++ {
				pg, err := r.Run(ctx, sc, trace.SER)
				if err != nil {
					t.Fatal(err)
				}
				if len(Diff(eng, pg)) > 0 {
					differ++
				}
			}
			t.Logf("%s, %d filler rows per key: PostgreSQL differed from the engine in %d of %d runs", name, pad, differ, runs)
			if pad == 0 && differ == 0 {
				t.Errorf("%s: no difference without padding; the divergence no longer reproduces", name)
			}
			if pad > 0 && differ != 0 {
				t.Errorf("%s: still differs with keys on separate pages (%d of %d runs); the page-granularity explanation does not hold", name, differ, runs)
			}
		}
	}
}
