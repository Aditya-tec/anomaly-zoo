package run

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/gen"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
	"github.com/Aditya-tec/anomaly-zoo/engine/txn"
)

// propN is the number of random schedules per level: 20 000 by default
// (spec §9.3), overridable for the nightly and local long runs.
func propN() int {
	if s := os.Getenv("AZOO_PROP_N"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			return n
		}
	}
	if testing.Short() {
		return 2000
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

// P2: store invariants.
func checkStore(tr *trace.Trace, m *txn.Manager) error {
	commits := uint64(0)
	for _, x := range tr.Txns {
		if x.Status == "committed" {
			commits++
		}
	}
	if m.Clock != commits+1 {
		return fmt.Errorf("clock %d != commits %d + 1", m.Clock, commits)
	}
	if l, w := m.Held(); l != 0 || w != 0 {
		return fmt.Errorf("locks=%d waits=%d left over", l, w)
	}
	for _, k := range m.Store.Keys() {
		var prev uint64
		for i, v := range m.Store.Chain(k) {
			if v.CommitTS == 0 {
				return fmt.Errorf("%s: uncommitted version left over", k)
			}
			if v.CommitTS <= prev && i > 0 {
				return fmt.Errorf("%s: chain not ordered by commitTS", k)
			}
			prev = v.CommitTS
		}
	}
	return nil
}

// mid-run chain shape, checked on every recorded store snapshot.
func checkChains(tr *trace.Trace) error {
	for _, e := range tr.Steps {
		for _, kv := range e.StoreAfter {
			var prev uint64
			for i, v := range kv.Versions {
				if v.CommitTS == 0 && i != len(kv.Versions)-1 {
					return fmt.Errorf("event %d: %s has an uncommitted version before the last", e.Index, kv.Key)
				}
				if v.CommitTS != 0 {
					if v.CommitTS <= prev {
						return fmt.Errorf("event %d: %s committed versions out of order", e.Index, kv.Key)
					}
					prev = v.CommitTS
				}
			}
		}
	}
	return nil
}

func committedTS(tr *trace.Trace) map[string]uint64 {
	m := map[string]uint64{}
	for _, x := range tr.Txns {
		if x.Status == "committed" {
			m[x.ID] = x.CommitTS
		}
	}
	return m
}

// P3: no dirty reads. Every version a read reports as visible must be a setup
// value, the reader's own write, or committed at or before the statement time,
// and its value must be the one the read returned.
func checkNoDirtyReads(tr *trace.Trace) error {
	commit := committedTS(tr)
	for _, e := range tr.Steps {
		if e.Status != trace.StOK || (e.Op != "READ" && e.Op != "SCAN") {
			continue
		}
		want := map[string]int64{}
		switch res := e.Result.(type) {
		case trace.ReadResult:
			want[e.Args.Key] = res.Value
		case trace.ScanResult:
			for _, kv := range res.Rows {
				want[kv.Key] = kv.Value
			}
		}
		for _, rd := range e.Reads {
			if rd.From == nil || !strings.HasPrefix(rd.Why, "visible_") {
				continue
			}
			switch {
			case rd.Why == trace.VisibleOwnWrite:
				if rd.From.Writer != e.Txn {
					return fmt.Errorf("event %d: own-write read of %s attributed to %s", e.Index, rd.Key, rd.From.Writer)
				}
			case rd.From.Writer == "T0":
			default:
				ts, ok := commit[rd.From.Writer]
				if !ok || ts != rd.From.CommitTS || ts > e.StmtTS {
					return fmt.Errorf("event %d: %s read %s's version (commitTS %d) not committed by stmtTS %d", e.Index, e.Txn, rd.From.Writer, rd.From.CommitTS, e.StmtTS)
				}
			}
			// The version must exist in the store with the returned value.
			found := false
			for _, kv := range e.StoreAfter {
				if kv.Key != rd.Key {
					continue
				}
				for _, v := range kv.Versions {
					if v.Writer == rd.From.Writer && v.CommitTS == rd.From.CommitTS && v.Value == want[rd.Key] {
						found = true
					}
				}
			}
			if !found {
				return fmt.Errorf("event %d: value read from %s on %s not found in store", e.Index, rd.From.Writer, rd.Key)
			}
		}
	}
	return nil
}

func scanSig(e *trace.Event) string {
	s := "SCAN " + e.Args.Prefix
	if e.Args.Where != nil {
		s += fmt.Sprintf(" %s %d", e.Args.Where.Cmp, e.Args.Where.Value)
	}
	return s
}

func resultSig(e *trace.Event) string {
	switch r := e.Result.(type) {
	case trace.ReadResult:
		return fmt.Sprintf("%v/%d", r.Absent, r.Value)
	case trace.ScanResult:
		return fmt.Sprint(r.Rows)
	}
	return ""
}

// nonRepeatable returns an error when a transaction reads the same key or
// scan twice with no own write in between and gets different answers (P4).
func nonRepeatable(tr *trace.Trace) error {
	type memo struct{ sig string }
	seen := map[string]map[string]string{} // txn -> read signature -> result
	for i := range tr.Steps {
		e := &tr.Steps[i]
		if e.Status != trace.StOK {
			continue
		}
		m := seen[e.Txn]
		if m == nil {
			m = map[string]string{}
			seen[e.Txn] = m
		}
		switch e.Op {
		case "READ", "SCAN":
			sig := "READ " + e.Args.Key
			if e.Op == "SCAN" {
				sig = scanSig(e)
			}
			res := resultSig(e)
			if prev, ok := m[sig]; ok && prev != res {
				return fmt.Errorf("%s: %s returned %s then %s", e.Txn, sig, prev, res)
			}
			m[sig] = res
		case "PUT", "DELETE":
			for sig := range m {
				if sig == "READ "+e.Args.Key || (strings.HasPrefix(sig, "SCAN ") && strings.HasPrefix(e.Args.Key, strings.Fields(sig)[1])) {
					delete(m, sig)
				}
			}
		}
	}
	return nil
}

// P5: no two concurrent committed transactions write the same key.
func checkNoLostUpdates(tr *trace.Trace) error {
	writes := map[string]map[string]bool{}
	for _, e := range tr.Steps {
		if e.Status == trace.StOK && (e.Op == "PUT" || e.Op == "DELETE") {
			if writes[e.Txn] == nil {
				writes[e.Txn] = map[string]bool{}
			}
			writes[e.Txn][e.Args.Key] = true
		}
	}
	for i, a := range tr.Txns {
		for _, b := range tr.Txns[i+1:] {
			if a.Status != "committed" || b.Status != "committed" {
				continue
			}
			if a.CommitTS > b.SnapshotTS && b.CommitTS > a.SnapshotTS {
				for k := range writes[a.ID] {
					if writes[b.ID][k] {
						return fmt.Errorf("%s and %s are concurrent and both wrote %s", a.ID, b.ID, k)
					}
				}
			}
		}
	}
	return nil
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
	nonSer, _ := runProperties(t, trace.SER, propN())
	t.Logf("SER: %d non-serializable histories (must be 0)", nonSer)
}
