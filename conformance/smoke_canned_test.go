package conformance

import (
	"context"
	"os"
	"testing"

	"github.com/Aditya-tec/anomaly-zoo/engine/matrix"
)

func TestCannedSmoke(t *testing.T) {
	dsn := os.Getenv("CONFORMANCE_DATABASE_URL")
	if dsn == "" {
		t.Skip("no database")
	}
	ctx := context.Background()
	r, err := NewRunner(ctx, dsn, "az_smoke")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close(ctx)
	scs, err := matrix.Scenarios("../scenarios")
	if err != nil {
		t.Fatal(err)
	}
	for _, sc := range scs {
		for _, lv := range Levels {
			e, err := Evaluate(ctx, r, Case{Name: sc.ID, Canned: true, SC: sc}, lv)
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("%-20s %-3s mismatch=%v unstable=%v eng=%v pg=%v diffs=%v", sc.ID, lv, e.Mismatch, e.Unstable, e.EngineCell, e.PGCell, e.Diffs)
		}
	}
}
