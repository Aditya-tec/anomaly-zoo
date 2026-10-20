package run

import (
	"fmt"
	"testing"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/gen"
	"github.com/Aditya-tec/anomaly-zoo/engine/oracle"
	"github.com/Aditya-tec/anomaly-zoo/engine/ssi"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
	"github.com/Aditya-tec/anomaly-zoo/engine/txn"
)

// serViolation reports whether sc yields a non-serializable history at SER.
func serViolation(sc *dsl.Scenario) bool {
	tr, err := Run(sc, trace.SER)
	return err == nil && !tr.Serializable.Verdict
}

// cannedBroken reports which canned scenarios stop being serializable at SER.
func cannedBroken(t *testing.T) []string {
	var out []string
	for _, id := range []string{"write-skew", "read-only-anomaly", "lost-update", "phantom", "read-skew", "non-repeatable-read", "dirty-read"} {
		if serViolation(load(t, id)) {
			out = append(out, id)
		}
	}
	return out
}

// Two rules of §4.8 are redundant for *correctness* (a dangerous structure can
// only appear when an edge is added or when O commits, and both moments are
// checked), so they are defense in depth. Random serializability checks cannot
// see them; these targeted checks observe their behaviour directly.

// afterCommitDoomsImmediately: once T1 commits, the doomed pivot T2 must abort
// on its very next operation, not only at COMMIT.
func afterCommitDoomsImmediately(t *testing.T) error {
	sc := parse(t, `scenario ac
setup:
  PUT doctor:alice = 1
  PUT doctor:bob = 1
  PUT z = 1
schedule:
  T1 BEGIN
  T2 BEGIN
  T1 SCAN doctor: WHERE == 1 AS on_t1
  T2 SCAN doctor: WHERE == 1 AS on_t2
  T1 PUT doctor:alice = 0
  T2 PUT doctor:bob = 0
  T1 COMMIT
  T2 READ z AS zz
  T2 COMMIT
`)
	tr, err := Run(sc, trace.SER)
	if err != nil {
		return err
	}
	e := find(tr, "T2", "READ", false)
	if e.Status != trace.StAborted || e.Reason != trace.AbortDependencies {
		return fmt.Errorf("T2's next operation after T1's commit is %s/%s, want aborted/abort_dependencies", e.Status, e.Reason)
	}
	return nil
}

// commitCheckSeesDanger: drive the manager and tracker by hand through the
// write-skew schedule and ask the commit-time check about the pivot T2.
func commitCheckSeesDanger() error {
	setup := []dsl.SetupPut{{Key: "doctor:alice", Value: 1}, {Key: "doctor:bob", Value: 1}}
	m := txn.New(trace.SER, setup)
	m.SSI = ssi.New()
	t1, t2 := m.Begin("T1"), m.Begin("T2")
	for _, t := range []*txn.Txn{t1, t2} {
		m.Scan(t, "doctor:", nil)
		m.SSI.OnScan(m, t, "doctor:")
	}
	m.Put(t1, "doctor:alice", 0, false, false)
	m.SSI.OnWrite(m, t1, "doctor:alice")
	m.Put(t2, "doctor:bob", 0, false, false)
	m.SSI.OnWrite(m, t2, "doctor:bob")
	if r := m.Commit(t1); r.Out.Status != txn.OutOK {
		return fmt.Errorf("T1 commit: %+v", r.Out)
	}
	if !m.SSI.DangerousAtCommit(m, t2) {
		return fmt.Errorf("commit-time check does not flag pivot T2 (I=O=T1 committed first)")
	}
	return nil
}

func TestAfterCommitDoomsImmediately(t *testing.T) {
	if err := afterCommitDoomsImmediately(t); err != nil {
		t.Fatal(err)
	}
}

func TestCommitCheckSeesDanger(t *testing.T) {
	if err := commitCheckSeesDanger(); err != nil {
		t.Fatal(err)
	}
}

// TestMutationChecks (AC4.3): disabling each rule of §4.8 must make at least
// one test fail, and the shrinker must be able to print a small schedule.
func TestMutationChecks(t *testing.T) {
	mutations := []struct {
		name     string
		fault    ssi.Faults
		targeted func() error // optional extra detector
	}{
		{"edge rule 1 (READ)", ssi.Faults{NoReadEdges: true}, nil},
		{"edge rule 2 (SCAN)", ssi.Faults{NoScanEdges: true}, nil},
		{"edge rule 3 (write vs SIREAD)", ssi.Faults{NoWriteEdges: true}, nil},
		{"dangerous check at COMMIT", ssi.Faults{NoCommitCheck: true}, commitCheckSeesDanger},
		{"after-commit re-check", ssi.Faults{NoAfterCommit: true}, func() error { return afterCommitDoomsImmediately(t) }},
	}
	// Sanity: the unmutated engine has no violations and passes both targeted checks.
	if got := cannedBroken(t); len(got) != 0 {
		t.Fatalf("unmutated engine broken on %v", got)
	}
	if err := commitCheckSeesDanger(); err != nil {
		t.Fatal(err)
	}
	if err := afterCommitDoomsImmediately(t); err != nil {
		t.Fatal(err)
	}

	smallest := 1 << 30
	var smallestSrc string
	for _, m := range mutations {
		ssi.Fault = m.fault
		func() {
			defer func() { ssi.Fault = ssi.Faults{} }()
			canned := cannedBroken(t)
			var found *dsl.Scenario
			var seed uint64
			for s := uint64(1); s <= 20000 && found == nil && m.targeted == nil; s++ {
				sc := gen.Generate(s, gen.Config{})
				if serViolation(sc) {
					found, seed = sc, s
				}
			}
			var targetedErr error
			if m.targeted != nil {
				targetedErr = m.targeted()
			}
			switch {
			case found != nil:
				min := oracle.Shrink(found, serViolation)
				n := len(min.Steps)
				t.Logf("%-32s caught: canned=%v, random seed %d (%d steps) shrunk to %d steps", m.name, canned, seed, len(found.Steps), n)
				if n < smallest {
					smallest, smallestSrc = n, dsl.Format(min)
				}
			case targetedErr != nil:
				t.Logf("%-32s caught by targeted check: %v", m.name, targetedErr)
			case len(canned) > 0:
				t.Logf("%-32s caught by canned scenarios %v", m.name, canned)
			default:
				t.Errorf("mutation %q survived: nothing failed", m.name)
			}
		}()
	}
	if smallest > 8 {
		t.Fatalf("no mutation shrank to <= 8 steps (best %d)", smallest)
	}
	t.Logf("smallest minimal schedule (%d steps):\n%s", smallest, smallestSrc)
}
