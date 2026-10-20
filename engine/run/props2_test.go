package run

import (
	"fmt"
	"reflect"
	"testing"

	"github.com/Aditya-tec/anomaly-zoo/engine/gen"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

// replayMatches checks that applying the per-event deltas reproduces every
// periodic full snapshot and the final store.
func replayMatches(tr *trace.Trace) error {
	rp := trace.NewReplayer(tr)
	fulls := 0
	for i := range tr.Steps {
		e := &tr.Steps[i]
		rp.Apply(e)
		if (e.Index%trace.FullSnapshotEvery == 0) != (e.StoreFull != nil) {
			return fmt.Errorf("event %d: storeFull presence wrong", e.Index)
		}
		if e.StoreFull == nil {
			continue
		}
		fulls++
		if len(e.StoreFull) != len(rp.Keys()) {
			return fmt.Errorf("event %d: full snapshot has %d keys, replay has %d", e.Index, len(e.StoreFull), len(rp.Keys()))
		}
		for _, kv := range e.StoreFull {
			if !reflect.DeepEqual(kv.Versions, rp.Chain(kv.Key)) {
				return fmt.Errorf("event %d: key %s differs between delta replay and full snapshot", e.Index, kv.Key)
			}
		}
	}
	// Final committed state equals finalState.
	for _, kv := range tr.FinalState {
		c := rp.Chain(kv.Key)
		if len(c) == 0 || c[len(c)-1].Value != kv.Value || c[len(c)-1].Deleted {
			return fmt.Errorf("final state of %s not reproduced by replay", kv.Key)
		}
	}
	return nil
}

func TestDeltaReplayMatchesFullSnapshots(t *testing.T) {
	for _, lv := range trace.Levels {
		for seed := uint64(1); seed <= 300; seed++ {
			sc := gen.Generate(seed, gen.Config{})
			tr := mustRun(t, sc, lv)
			if err := replayMatches(tr); err != nil {
				failSchedule(t, sc, lv, seed, err)
			}
		}
	}
	for _, lv := range trace.Levels {
		if err := replayMatches(mustRun(t, parse(t, worstCaseSource()), lv)); err != nil {
			t.Fatalf("worst case %s: %v", lv, err)
		}
	}
}

// TestEverySchedulePassesSchemaAndDigest is the unsampled version of the P1
// checks: 2,000 seeds at every level, each validated against the schema, with
// the digest recomputed from the bytes and stable across a second run.
func TestEverySchedulePassesSchemaAndDigest(t *testing.T) {
	seeds := uint64(2000)
	if testing.Short() {
		seeds = 200 // the race-detector CI step; the full 2,000 runs without -short
	}
	for _, lv := range trace.Levels {
		for seed := uint64(1); seed <= seeds; seed++ {
			sc := gen.Generate(seed, gen.Config{})
			tr := mustRun(t, sc, lv)
			b, err := tr.Marshal()
			if err == nil {
				err = trace.ValidateJSON(b)
			}
			if err != nil {
				failSchedule(t, sc, lv, seed, err)
			}
			if d, _ := trace.ComputeDigest(tr); d != tr.Digest {
				failSchedule(t, sc, lv, seed, fmt.Errorf("digest does not match content"))
			}
			if again := mustRun(t, sc, lv); again.Digest != tr.Digest {
				failSchedule(t, sc, lv, seed, fmt.Errorf("digest unstable across runs"))
			}
		}
	}
}
