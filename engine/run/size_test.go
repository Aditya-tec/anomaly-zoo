package run

import (
	"fmt"
	"strings"
	"testing"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

// worstCaseSource builds a schedule near the limits (<= 200 steps, 64 keys,
// 8 KB) that maximises trace size: 64 keys, three transactions each writing all
// of them, with T2 and T3 blocked behind T1 so that every statement yields a
// blocked/queued event and later a resumed event.
func worstCaseSource() string {
	var b strings.Builder
	b.WriteString("scenario worst-case\nsetup:\n")
	for k := 0; k < 64; k++ {
		fmt.Fprintf(&b, "  PUT k%02d = 1\n", k)
	}
	b.WriteString("schedule:\n  T1 BEGIN\n  T2 BEGIN\n  T3 BEGIN\n")
	for _, id := range []string{"T1", "T2", "T3"} {
		for k := 0; k < 64; k++ {
			fmt.Fprintf(&b, "  %s PUT k%02d = %d\n", id, k, k)
		}
	}
	b.WriteString("  T1 COMMIT\n  T2 COMMIT\n  T3 COMMIT\n")
	return b.String()
}

func TestWorstCaseTraceSize(t *testing.T) {
	src := worstCaseSource()
	sc, errs := dsl.Parse(src)
	if len(errs) > 0 {
		t.Fatalf("worst-case source invalid: %v", errs)
	}
	if len(src) > dsl.MaxSource || len(sc.Steps) > dsl.MaxSteps {
		t.Fatalf("source %d bytes, %d steps exceed limits", len(src), len(sc.Steps))
	}
	worst := 0
	for _, lv := range trace.Levels {
		tr, err := Run(sc, lv)
		if err != nil {
			t.Fatal(err)
		}
		b, err := tr.Marshal()
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("%s: %d steps scheduled, %d events, trace %d bytes", lv, len(sc.Steps), len(tr.Steps), len(b))
		if len(b) > worst {
			worst = len(b)
		}
		if err := trace.ValidateJSON(b); err != nil {
			t.Fatal(err)
		}
	}
	if worst > 1<<20 {
		t.Fatalf("worst-case trace is %d bytes (> 1 MiB)", worst)
	}
}
