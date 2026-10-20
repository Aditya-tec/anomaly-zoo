package run

import (
	"fmt"
	"os"
	"strconv"
	"testing"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/gen"
	"github.com/Aditya-tec/anomaly-zoo/engine/ssi"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

// propN is the number of random schedules per level: 20 000 by default
// (spec §9.3), overridable for the nightly and local long runs.
func propN() int {
	if s := os.Getenv("AZOO_PROP_N"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			return n
		}
	}
	// -short is what CI uses under the race detector (about 10x slower). The
	// full 20,000 per level runs in the separate non-race step.
	if testing.Short() {
		return 1000
	}
	return 20000
}

func propSeedBase() uint64 {
	if s := os.Getenv("AZOO_PROP_SEED"); s != "" {
		if n, err := strconv.ParseUint(s, 10, 64); err == nil {
			return n
		}
	}
	return 1
}

func failSchedule(t *testing.T, sc *dsl.Scenario, lv trace.Level, seed uint64, err error) {
	t.Helper()
	t.Fatalf("%s seed %d: %v\n%s", lv, seed, err, dsl.Format(sc))
}

// runProperties executes n random schedules at lv and applies the checks that
// hold at that level. It returns how many schedules were non-serializable and
// how many contained a non-repeatable read.
func runProperties(t *testing.T, lv trace.Level, n int) (nonSer, nonRep int) {
	base := propSeedBase()
	for i := 0; i < n; i++ {
		seed := base + uint64(i)
		sc := gen.Generate(seed, gen.Config{})
		tr, m, err := Exec(sc, lv)
		if err != nil {
			failSchedule(t, sc, lv, seed, err)
		}
		// P1: terminates, schema-valid (sampled to keep runtime sane), stable digest.
		if i%25 == 0 {
			b, err := tr.Marshal()
			if err == nil {
				err = trace.ValidateJSON(b)
			}
			if err != nil {
				failSchedule(t, sc, lv, seed, fmt.Errorf("P1 schema: %w", err))
			}
		}
		if i%10 == 0 {
			tr2, _ := Run(sc, lv)
			if tr.Digest != tr2.Digest {
				failSchedule(t, sc, lv, seed, fmt.Errorf("P1 digest unstable"))
			}
		}
		// P2
		if err := checkStore(tr, m); err != nil {
			failSchedule(t, sc, lv, seed, fmt.Errorf("P2: %w", err))
		}
		if i%10 == 0 {
			if err := checkChains(tr); err != nil {
				failSchedule(t, sc, lv, seed, fmt.Errorf("P2: %w", err))
			}
		}
		if lv != trace.RU {
			if err := checkNoDirtyReads(tr); err != nil { // P3
				failSchedule(t, sc, lv, seed, fmt.Errorf("P3: %w", err))
			}
		}
		rep := nonRepeatable(tr)
		if rep != nil {
			nonRep++
		}
		if lv == trace.SI || lv == trace.SER {
			if rep != nil { // P4
				failSchedule(t, sc, lv, seed, fmt.Errorf("P4: %w", rep))
			}
			if err := checkNoLostUpdates(tr); err != nil { // P5
				failSchedule(t, sc, lv, seed, fmt.Errorf("P5: %w", err))
			}
		}
		if !tr.Serializable.Verdict {
			nonSer++
			if lv == trace.SER { // P6
				failSchedule(t, sc, lv, seed, fmt.Errorf("P6: oracle rejected a SER history"))
			}
		}
	}
	return
}

func TestPropertiesRU(t *testing.T) { runProperties(t, trace.RU, propN()) }

func TestPropertiesRC(t *testing.T) {
	_, nonRep := runProperties(t, trace.RC, propN())
	if nonRep == 0 { // P7 vacuity guard
		t.Fatal("P7: no non-repeatable read found at RC; generator or checker is broken")
	}
	t.Logf("RC: %d schedules with a non-repeatable read", nonRep)
}

func TestPropertiesSI(t *testing.T) {
	nonSer, _ := runProperties(t, trace.SI, propN())
	if nonSer == 0 { // P7 vacuity guard
		t.Fatal("P7: no non-serializable SI history found; generator or oracle is broken")
	}
	t.Logf("SI: %d non-serializable histories", nonSer)
}

func TestPropertiesSER(t *testing.T) {
	switch f := os.Getenv("AZOO_SSI_FAULT"); f {
	case "":
	case "NoCommitCheck":
		ssi.Fault.NoCommitCheck = true
	case "NoAfterCommit":
		ssi.Fault.NoAfterCommit = true
	default:
		t.Fatalf("unknown AZOO_SSI_FAULT %q", f)
	}
	defer func() { ssi.Fault = ssi.Faults{} }()
	nonSer, _ := runProperties(t, trace.SER, propN())
	t.Logf("SER: %d non-serializable histories (must be 0)", nonSer)
}
