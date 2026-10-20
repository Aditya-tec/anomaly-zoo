package run

import (
	"bytes"
	"flag"
	"os"
	"path/filepath"
	"testing"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

var update = flag.Bool("update", false, "rewrite golden traces")

// goldenLevels grows with the phases: RU,RC at P2, SI at P3, SER at P4.
var goldenLevels = []trace.Level{trace.RU, trace.RC, trace.SI}

func load(t *testing.T, id string) *dsl.Scenario {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "scenarios", id+".azs"))
	if err != nil {
		t.Fatal(err)
	}
	return parse(t, string(b))
}

func parse(t *testing.T, src string) *dsl.Scenario {
	t.Helper()
	sc, errs := dsl.Parse(src)
	if len(errs) > 0 {
		t.Fatalf("parse: %v\n%s", errs, src)
	}
	return sc
}

func mustRun(t *testing.T, sc *dsl.Scenario, lv trace.Level) *trace.Trace {
	t.Helper()
	tr, err := Run(sc, lv)
	if err != nil {
		t.Fatal(err)
	}
	return tr
}

func final(tr *trace.Trace, key string) (int64, bool) {
	for _, kv := range tr.FinalState {
		if kv.Key == key {
			return kv.Value, true
		}
	}
	return 0, false
}

func find(tr *trace.Trace, txnID, op string, resumed bool) *trace.Event {
	for i := range tr.Steps {
		e := &tr.Steps[i]
		if e.Txn == txnID && e.Op == op && e.Resumed == resumed {
			return e
		}
	}
	return nil
}

func hasEffect(e *trace.Event, kind, reason string) bool {
	for _, f := range e.Effects {
		if f.Kind == kind && (reason == "" || f.Reason == reason) {
			return true
		}
	}
	return false
}

func TestLostUpdateRC(t *testing.T) {
	tr := mustRun(t, load(t, "lost-update"), trace.RC)
	if v, _ := final(tr, "balance"); v != 130 {
		t.Fatalf("final = %d, want 130", v)
	}
	blocked := find(tr, "T2", "PUT", false)
	if blocked.Status != trace.StBlocked || blocked.BlockedOn != "T1" {
		t.Fatalf("T2 PUT not blocked on T1: %+v", blocked)
	}
	resumed := find(tr, "T2", "PUT", true)
	if resumed == nil || resumed.Status != trace.StOK || resumed.ScheduledIndex != blocked.ScheduledIndex {
		t.Fatalf("bad resumed event: %+v", resumed)
	}
	if !hasEffect(resumed, trace.EffLockAcquired, trace.LockGrantedAfterWait) {
		t.Fatal("resumed event lacks lock_granted_after_wait")
	}
	if tr.Invariants[0].Status != "violated" {
		t.Fatalf("invariant %+v", tr.Invariants[0])
	}
}

func TestLostUpdateSI(t *testing.T) {
	tr := mustRun(t, load(t, "lost-update"), trace.SI)
	if v, _ := final(tr, "balance"); v != 150 {
		t.Fatalf("final = %d, want 150", v)
	}
	blocked := find(tr, "T2", "PUT", false)
	resumed := find(tr, "T2", "PUT", true)
	if blocked.Status != trace.StBlocked || resumed.Status != trace.StAborted || resumed.Reason != trace.AbortConcurrentUpdate {
		t.Fatalf("blocked=%+v resumed=%+v", blocked, resumed)
	}
	if resumed.SnapshotTS != 1 || tr.Txns[0].CommitTS != 2 {
		t.Fatalf("snapshot %d, T1 commitTS %d", resumed.SnapshotTS, tr.Txns[0].CommitTS)
	}
	if c := find(tr, "T2", "COMMIT", false); c.Status != trace.StSkipped {
		t.Fatalf("T2 COMMIT = %s", c.Status)
	}
	if tr.Invariants[0].Status != "holds" {
		t.Fatalf("%+v", tr.Invariants[0])
	}
}

func TestFirstUpdaterWinsWithoutWaiting(t *testing.T) {
	// T1 commits before T2 ever asks for the lock, so the abort is immediate.
	sc := parse(t, `scenario f
setup:
  PUT x = 1
schedule:
  T1 BEGIN
  T2 BEGIN
  T2 READ x AS a
  T1 PUT x = 2
  T1 COMMIT
  T2 PUT x = 3
  T2 COMMIT
`)
	tr := mustRun(t, sc, trace.SI)
	e := find(tr, "T2", "PUT", false)
	if e.Status != trace.StAborted || e.Reason != trace.AbortConcurrentUpdate || e.Resumed {
		t.Fatalf("%+v", e)
	}
	if v, _ := final(tr, "x"); v != 2 {
		t.Fatalf("x = %d", v)
	}
	// The same schedule at RC lets T2 overwrite.
	if v, _ := final(mustRun(t, sc, trace.RC), "x"); v != 3 {
		t.Fatalf("RC x = %d", v)
	}
}

func TestSnapshotTakenAtFirstDataOperation(t *testing.T) {
	// T1 BEGINs first but does not touch data until after T2 commits, so its
	// snapshot already includes T2's write (snapshot is not taken at BEGIN).
	sc := parse(t, `scenario s
setup:
  PUT x = 1
schedule:
  T1 BEGIN
  T2 BEGIN
  T2 PUT x = 2
  T2 COMMIT
  T1 READ x AS a
  T1 COMMIT
`)
	tr := mustRun(t, sc, trace.SI)
	e := find(tr, "T1", "READ", false)
	if e.Result.(trace.ReadResult).Value != 2 || e.SnapshotTS != 2 {
		t.Fatalf("%+v", e)
	}
	if b := find(tr, "T1", "BEGIN", false); b.SnapshotTS != 0 {
		t.Fatalf("BEGIN must not take a snapshot: %+v", b)
	}
}

func TestSIHidesNewerAndUncommitted(t *testing.T) {
	tr := mustRun(t, load(t, "non-repeatable-read"), trace.SI)
	e := find(tr, "T1", "READ", false)
	second := tr.Steps[len(tr.Steps)-2]
	if second.Op != "READ" || second.Result.(trace.ReadResult).Value != 100 {
		t.Fatalf("%+v", second)
	}
	if len(second.Reads) != 2 || second.Reads[1].Why != trace.InvisibleNewerSnapshot {
		t.Fatalf("%+v", second.Reads)
	}
	_ = e
}

func TestDirtyReadRU(t *testing.T) {
	tr := mustRun(t, load(t, "dirty-read"), trace.RU)
	e := find(tr, "T2", "READ", false)
	if r := e.Result.(trace.ReadResult); r.Value != 2 {
		t.Fatalf("T2 read %d, want 2", r.Value)
	}
	if e.Reads[0].Why != trace.VisibleDirty || e.Reads[0].From.CommitTS != 0 {
		t.Fatalf("reads %+v", e.Reads)
	}
}

func TestDirtyReadRC(t *testing.T) {
	tr := mustRun(t, load(t, "dirty-read"), trace.RC)
	e := find(tr, "T2", "READ", false)
	if r := e.Result.(trace.ReadResult); r.Value != 1 {
		t.Fatalf("T2 read %d, want 1", r.Value)
	}
	if len(e.Reads) != 2 || e.Reads[1].Why != trace.InvisibleUncommittedOth {
		t.Fatalf("reads %+v", e.Reads)
	}
}

func TestDeadlock(t *testing.T) {
	for _, lv := range goldenLevels {
		tr := mustRun(t, load(t, "deadlock"), lv)
		var t2 trace.TxnSummary
		for _, x := range tr.Txns {
			if x.ID == "T2" {
				t2 = x
			}
		}
		if t2.Status != "aborted" || *t2.AbortReason != trace.AbortDeadlock {
			t.Fatalf("%s: T2 = %+v", lv, t2)
		}
		// T1's pending PUT b=3 resumes after T2's abort releases b.
		r := find(tr, "T1", "PUT", true)
		if r == nil || r.Status != trace.StOK || r.Args.Key != "b" {
			t.Fatalf("%s: T1 PUT b not resumed: %+v", lv, r)
		}
		if c := find(tr, "T2", "COMMIT", false); c.Status != trace.StSkipped {
			t.Fatalf("%s: T2 COMMIT = %s", lv, c.Status)
		}
		if v, _ := final(tr, "a"); v != 2 {
			t.Fatalf("a = %d", v)
		}
		if v, _ := final(tr, "b"); v != 3 {
			t.Fatalf("b = %d", v)
		}
	}
}

func TestQueuedStepsBehindBlockedStatement(t *testing.T) {
	sc := parse(t, `scenario q
setup:
  PUT x = 0
schedule:
  T1 BEGIN
  T2 BEGIN
  T1 PUT x = 1
  T2 PUT x = 2
  T2 READ x AS a
  T1 COMMIT
  T2 COMMIT
`)
	tr := mustRun(t, sc, trace.RC)
	var seq []string
	for _, e := range tr.Steps {
		if e.Txn == "T2" && e.Op != "BEGIN" {
			seq = append(seq, e.Op+":"+e.Status)
			if e.Resumed {
				seq[len(seq)-1] += "*"
			}
		}
	}
	want := []string{"PUT:blocked", "READ:queued", "PUT:ok*", "READ:ok*", "COMMIT:ok"}
	if len(seq) != len(want) {
		t.Fatalf("seq %v", seq)
	}
	for i := range want {
		if seq[i] != want[i] {
			t.Fatalf("seq %v, want %v", seq, want)
		}
	}
	rd := find(tr, "T2", "READ", true)
	if rd.Reads[0].Why != trace.VisibleOwnWrite || rd.Result.(trace.ReadResult).Value != 2 {
		t.Fatalf("queued READ should see own write: %+v", rd)
	}
	// Execution order differs from schedule order.
	if rd.Index <= rd.ScheduledIndex-1 || rd.ScheduledIndex != 4 {
		t.Fatalf("indices: %+v", rd)
	}
}

func TestDrainBlocksAgain(t *testing.T) {
	sc := parse(t, `scenario d
setup:
  PUT x = 0
  PUT y = 0
schedule:
  T1 BEGIN
  T2 BEGIN
  T3 BEGIN
  T1 PUT x = 1
  T3 PUT y = 1
  T2 PUT x = 2
  T2 PUT y = 5
  T2 COMMIT
  T1 COMMIT
  T3 COMMIT
`)
	tr := mustRun(t, sc, trace.RC)
	var seq []string
	for _, e := range tr.Steps {
		if e.Txn == "T2" && e.Op != "BEGIN" {
			s := e.Op + ":" + e.Status
			if e.Status == trace.StBlocked {
				s += "@" + e.BlockedOn
			}
			if e.Resumed {
				s += "*"
			}
			seq = append(seq, s)
		}
	}
	want := []string{"PUT:blocked@T1", "PUT:queued", "COMMIT:queued", "PUT:ok*", "PUT:blocked@T3*", "PUT:ok*", "COMMIT:ok*"}
	if len(seq) != len(want) {
		t.Fatalf("seq %v", seq)
	}
	for i := range want {
		if seq[i] != want[i] {
			t.Fatalf("seq %v, want %v", seq, want)
		}
	}
	if v, _ := final(tr, "y"); v != 5 {
		t.Fatalf("y = %d", v)
	}
}

func TestDrainAbortSkipsRest(t *testing.T) {
	// T2's queued PUT y runs after wake and hits a deadlock with T1; the queued
	// COMMIT behind it is then skipped.
	sc := parse(t, `scenario d
setup:
  PUT x = 0
  PUT y = 0
schedule:
  T1 BEGIN
  T2 BEGIN
  T1 PUT x = 1
  T2 PUT y = 2
  T2 PUT x = 3
  T2 COMMIT
  T1 PUT y = 4
  T1 COMMIT
`)
	tr := mustRun(t, sc, trace.RC)
	for _, x := range tr.Txns {
		if x.ID == "T1" && x.Status != "aborted" {
			t.Fatalf("T1 (executing PUT y) should be the deadlock victim: %+v", x)
		}
	}
	if c := find(tr, "T2", "COMMIT", true); c == nil || c.Status != trace.StOK {
		t.Fatalf("T2 should commit after T1 aborts: %+v", c)
	}
	if c := find(tr, "T1", "COMMIT", false); c.Status != trace.StSkipped {
		t.Fatalf("T1 COMMIT = %s", c.Status)
	}
}

func TestFIFOWakeAndReblock(t *testing.T) {
	sc := parse(t, `scenario f
setup:
  PUT x = 0
schedule:
  T1 BEGIN
  T2 BEGIN
  T3 BEGIN
  T1 PUT x = 1
  T2 PUT x = 2
  T3 PUT x = 3
  T1 COMMIT
  T2 COMMIT
  T3 COMMIT
`)
	tr := mustRun(t, sc, trace.RC)
	// After T1 commits, T2 (first in FIFO) takes the lock; T3 re-blocks on T2.
	var t3 []string
	for _, e := range tr.Steps {
		if e.Txn == "T3" && e.Op == "PUT" {
			s := e.Status
			if e.Status == trace.StBlocked {
				s += "@" + e.BlockedOn
			}
			t3 = append(t3, s)
		}
	}
	if len(t3) != 3 || t3[0] != "blocked@T1" || t3[1] != "blocked@T2" || t3[2] != "ok" {
		t.Fatalf("T3 PUT events: %v", t3)
	}
	if v, _ := final(tr, "x"); v != 3 {
		t.Fatalf("x = %d, want 3 (last writer wins in FIFO order)", v)
	}
}

func TestRuntimeErrorAborts(t *testing.T) {
	sc := parse(t, `scenario r
setup:
  PUT x = 1000000000
schedule:
  T1 BEGIN
  T1 READ x AS a
  T1 PUT x = a + 1
  T1 COMMIT
`)
	tr := mustRun(t, sc, trace.RC)
	if tr.Txns[0].Status != "aborted" || *tr.Txns[0].AbortReason != trace.AbortRuntimeError {
		t.Fatalf("%+v", tr.Txns[0])
	}
	if c := find(tr, "T1", "COMMIT", false); c.Status != trace.StSkipped {
		t.Fatalf("COMMIT = %s", c.Status)
	}
}

func TestDeleteAndScan(t *testing.T) {
	sc := parse(t, `scenario d
setup:
  PUT k:1 = 5
  PUT k:2 = 6
schedule:
  T1 BEGIN
  T1 DELETE k:1
  T1 SCAN k: AS s
  T1 READ k:1 AS gone
  T1 COMMIT
`)
	tr := mustRun(t, sc, trace.RC)
	scan := find(tr, "T1", "SCAN", false).Result.(trace.ScanResult)
	if scan.Count != 1 || scan.Sum != 6 {
		t.Fatalf("scan %+v", scan)
	}
	rd := find(tr, "T1", "READ", false)
	if !rd.Result.(trace.ReadResult).Absent {
		t.Fatal("deleted key should read as absent")
	}
	if _, ok := final(tr, "k:1"); ok {
		t.Fatal("k:1 should be gone")
	}
}

func TestExplicitAbortRollsBack(t *testing.T) {
	sc := parse(t, `scenario a
setup:
  PUT x = 1
schedule:
  T1 BEGIN
  T1 PUT x = 9
  T1 ABORT
`)
	tr := mustRun(t, sc, trace.RC)
	if v, _ := final(tr, "x"); v != 1 {
		t.Fatalf("x = %d", v)
	}
	if *tr.Txns[0].AbortReason != trace.AbortUser {
		t.Fatalf("%+v", tr.Txns[0])
	}
}

func TestBlockedAtEnd(t *testing.T) {
	// Not reachable from a validated schedule, so build it by hand: T1 never
	// ends while T2 waits on it.
	sc := parse(t, `scenario b
setup:
  PUT x = 1
schedule:
  T1 BEGIN
  T2 BEGIN
  T1 PUT x = 2
  T2 PUT x = 3
  T2 READ x AS a
  T2 COMMIT
  T1 COMMIT
`)
	sc.Steps = sc.Steps[:len(sc.Steps)-1]
	tr := mustRun(t, sc, trace.RC)
	e := find(tr, "T2", "PUT", true)
	if e == nil || e.Status != trace.StAborted || e.Reason != trace.BlockedAtEnd {
		t.Fatalf("T2 PUT resumed event: %+v", e)
	}
	if v, _ := final(tr, "x"); v != 1 {
		t.Fatalf("everything should roll back, x = %d", v)
	}
	skipped := 0
	for _, e := range tr.Steps {
		if e.Status == trace.StSkipped && e.Txn == "T2" {
			skipped++
		}
	}
	if skipped != 2 {
		t.Fatalf("want 2 skipped queued steps, got %d", skipped)
	}
}

func TestNoteEvent(t *testing.T) {
	tr := mustRun(t, load(t, "write-skew"), trace.RC)
	e := find(tr, "T1", "NOTE", false)
	if e.Note == nil || *e.Note != "Two are on call, so Alice can leave." {
		t.Fatalf("%+v", e)
	}
}

func TestTracesValidateAndDigestsStable(t *testing.T) {
	files, _ := filepath.Glob("../../scenarios/*.azs")
	for _, f := range files {
		b, _ := os.ReadFile(f)
		sc := parse(t, string(b))
		for _, lv := range goldenLevels {
			a := mustRun(t, sc, lv)
			b2 := mustRun(t, sc, lv)
			ja, err := a.Marshal()
			if err != nil {
				t.Fatal(err)
			}
			jb, _ := b2.Marshal()
			if !bytes.Equal(ja, jb) || a.Digest != b2.Digest {
				t.Fatalf("%s@%s: not deterministic", sc.ID, lv)
			}
			if err := trace.ValidateJSON(ja); err != nil {
				t.Fatalf("%s@%s: schema: %v", sc.ID, lv, err)
			}
			d, _ := trace.ComputeDigest(a)
			if d != a.Digest {
				t.Fatalf("%s@%s: digest mismatch", sc.ID, lv)
			}
			if bytes.Contains(ja, []byte("\r")) || bytes.Contains(ja, []byte("\n")) {
				t.Fatalf("%s@%s: trace contains a line break", sc.ID, lv)
			}
			if len(ja) > 20*1024 {
				t.Errorf("%s@%s: trace is %d bytes (> 20 KB)", sc.ID, lv, len(ja))
			}
		}
	}
}

func TestGolden(t *testing.T) {
	files, _ := filepath.Glob("../../scenarios/*.azs")
	dir := filepath.Join("..", "testdata", "golden")
	if *update {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, f := range files {
		b, _ := os.ReadFile(f)
		sc := parse(t, string(b))
		for _, lv := range goldenLevels {
			got, err := mustRun(t, sc, lv).Marshal()
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(dir, sc.ID+"."+string(lv)+".json")
			if *update {
				if err := os.WriteFile(path, got, 0o644); err != nil {
					t.Fatal(err)
				}
				continue
			}
			want, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("missing golden %s (run with -update): %v", path, err)
			}
			if !bytes.Equal(got, want) {
				t.Errorf("%s differs from golden; review and re-run with -update", path)
			}
		}
	}
}
