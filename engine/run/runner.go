// Package run executes a schedule against the transaction manager and builds
// the trace (spec §4.11, §5.6).
package run

import (
	"fmt"
	"sort"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/oracle"
	"github.com/Aditya-tec/anomaly-zoo/engine/ssi"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
	"github.com/Aditya-tec/anomaly-zoo/engine/txn"
)

type pendingStep struct {
	step  dsl.Step
	sched int
}

type txnRun struct {
	pending *pendingStep
	queue   []pendingStep
	ops     []oracle.Op
}

type runner struct {
	sc      *dsl.Scenario
	level   trace.Level
	m       *txn.Manager
	events  []trace.Event
	txns    map[string]*txnRun
	blocked []string // FIFO block order
}

// Run executes sc at level and returns the sealed trace.
func Run(sc *dsl.Scenario, level trace.Level) (*trace.Trace, error) {
	t, _, err := Exec(sc, level)
	return t, err
}

// Exec is Run that also returns the final manager state, for invariant
// checks in tests.
func Exec(sc *dsl.Scenario, level trace.Level) (*trace.Trace, *txn.Manager, error) {
	if !level.Valid() {
		return nil, nil, fmt.Errorf("unknown level %q", level)
	}
	r := &runner{sc: sc, level: level, m: txn.New(level, sc.Setup), txns: map[string]*txnRun{}}
	if level == trace.SER {
		r.m.SSI = ssi.New()
	}
	for i, st := range sc.Steps {
		r.schedule(st, i)
	}
	r.finish()
	t, err := r.build()
	return t, r.m, err
}

func (r *runner) schedule(st dsl.Step, sched int) {
	tr := r.txns[st.Txn]
	if tr == nil {
		tr = &txnRun{}
		r.txns[st.Txn] = tr
	}
	t := r.m.Txns[st.Txn]
	switch {
	case t != nil && t.Status == txn.Aborted:
		r.emitPassive(st, sched, false, trace.StSkipped, trace.SkippedTxnAborted)
	case tr.pending != nil:
		tr.queue = append(tr.queue, pendingStep{st, sched})
		r.emitPassive(st, sched, false, trace.StQueued, "")
	default:
		out := r.execute(st, sched, false)
		r.afterExecute(st.Txn, st, sched, out, false)
	}
}

// afterExecute updates pending state after a statement ran. It returns true
// when the transaction was left blocked.
func (r *runner) afterExecute(id string, st dsl.Step, sched int, out txn.Outcome, resumed bool) {
	tr := r.txns[id]
	t := r.m.Txns[id]
	switch out.Status {
	case txn.OutBlocked:
		if !resumed {
			tr.pending = &pendingStep{st, sched}
			r.blocked = append(r.blocked, id)
		}
	case txn.OutAborted:
		r.clearPending(id)
		r.skipQueue(id)
	}
	if t != nil && t.Status != txn.Active {
		r.wake()
	}
}

func (r *runner) clearPending(id string) {
	r.txns[id].pending = nil
	for i, b := range r.blocked {
		if b == id {
			r.blocked = append(r.blocked[:i], r.blocked[i+1:]...)
			return
		}
	}
}

func (r *runner) skipQueue(id string) {
	tr := r.txns[id]
	q := tr.queue
	tr.queue = nil
	for _, p := range q {
		r.emitPassive(p.step, p.sched, true, trace.StSkipped, trace.SkippedTxnAborted)
	}
}

// wake retries blocked statements in FIFO order until nothing changes.
func (r *runner) wake() {
	for {
		progressed := false
		for _, id := range append([]string(nil), r.blocked...) {
			tr := r.txns[id]
			p := tr.pending
			holder, held := r.m.LockHolder(p.step.Key)
			if waiting, ok := r.m.WaitingOn(id); held && ok && waiting == holder {
				continue
			}
			progressed = true
			out := r.execute(p.step, p.sched, true)
			switch out.Status {
			case txn.OutBlocked:
			case txn.OutAborted:
				r.clearPending(id)
				r.skipQueue(id)
			default:
				r.clearPending(id)
				r.drain(id)
			}
			break
		}
		if !progressed {
			return
		}
	}
}

// drain runs the steps queued behind a statement that has just completed.
func (r *runner) drain(id string) {
	tr := r.txns[id]
	for len(tr.queue) > 0 {
		p := tr.queue[0]
		tr.queue = tr.queue[1:]
		out := r.execute(p.step, p.sched, true)
		switch out.Status {
		case txn.OutBlocked:
			tr.pending = &pendingStep{p.step, p.sched}
			r.blocked = append(r.blocked, id)
			return
		case txn.OutAborted:
			r.skipQueue(id)
			return
		}
	}
}

// finish rolls back anything still blocked when the schedule ends.
func (r *runner) finish() {
	for len(r.blocked) > 0 {
		id := r.blocked[0]
		tr := r.txns[id]
		p := tr.pending
		t := r.m.Txns[id]
		ev := r.newEvent(p.step, p.sched, true)
		ev.Status, ev.Reason = trace.StAborted, trace.BlockedAtEnd
		ev.Effects = r.m.Abort(t, trace.BlockedAtEnd)
		r.push(ev, t)
		r.clearPending(id)
		r.skipQueue(id)
		r.wake()
	}
}

func (r *runner) argsOf(st dsl.Step) trace.Args {
	a := trace.Args{}
	switch st.Op {
	case "READ":
		a.Key, a.As = st.Key, st.As
	case "SCAN":
		a.Prefix, a.As = st.Key, st.As
		if st.Where != nil {
			a.Where = &trace.Where{Cmp: st.Where.Cmp, Value: st.Where.Value}
		}
	case "PUT":
		a.Key, a.Expr = st.Key, st.Expr.Format()
	case "DELETE":
		a.Key = st.Key
	case "NOTE":
		a.Text = st.Text
	}
	return a
}

func (r *runner) newEvent(st dsl.Step, sched int, resumed bool) trace.Event {
	return trace.Event{
		ScheduledIndex: sched, Resumed: resumed, Txn: st.Txn, Op: st.Op, Args: r.argsOf(st),
		Reads: []trace.Read{}, Effects: []trace.Effect{},
	}
}

func (r *runner) push(ev trace.Event, t *txn.Txn) {
	ev.Index = len(r.events)
	if t != nil {
		ev.SnapshotTS = t.SnapshotTS
	}
	ev.StoreAfter = r.m.Store.Snapshot()
	r.events = append(r.events, ev)
}

func (r *runner) emitPassive(st dsl.Step, sched int, resumed bool, status, reason string) {
	ev := r.newEvent(st, sched, resumed)
	ev.Status, ev.Reason = status, reason
	r.push(ev, r.m.Txns[st.Txn])
}

type txnEnv struct{ t *txn.Txn }

func (e txnEnv) Var(n string) (dsl.Binding, bool)  { b, ok := e.t.Vars[n]; return b, ok }
func (txnEnv) FinalVal(string) int64               { return 0 }
func (txnEnv) FinalCount(string, *dsl.Where) int64 { return 0 }
func (txnEnv) FinalSum(string) int64               { return 0 }
func (txnEnv) Committed(string) bool               { return false }

// execute runs one statement and records its event.
func (r *runner) execute(st dsl.Step, sched int, resumed bool) txn.Outcome {
	ev := r.newEvent(st, sched, resumed)
	var t *txn.Txn
	if st.Op == "BEGIN" {
		t = r.m.Begin(st.Txn)
	} else {
		t = r.m.Txns[st.Txn]
	}
	tr := r.txns[st.Txn]
	if st.Op == "READ" || st.Op == "SCAN" || st.Op == "PUT" || st.Op == "DELETE" {
		ev.StmtTS = r.m.Clock
	}
	var res txn.Result
	switch st.Op {
	case "BEGIN":
	case "NOTE":
		s := st.Text
		ev.Note = &s
	case "READ":
		res = r.hooked(t, r.m.Read(t, st.Key), func() txn.Hook { return r.m.SSI.OnRead(r.m, t, st.Key) })
		if res.Out.Status == txn.OutOK {
			ev.Result = trace.ReadResult{Value: res.Value, Absent: res.Absent}
			t.Vars[st.As] = dsl.Binding{Value: res.Value, Count: 1 - b2i(res.Absent), Sum: res.Value}
			tr.ops = append(tr.ops, oracle.Op{Kind: "READ", Key: st.Key, As: st.As, Value: res.Value, Absent: res.Absent})
		}
	case "SCAN":
		res = r.hooked(t, r.m.Scan(t, st.Key, st.Where), func() txn.Hook { return r.m.SSI.OnScan(r.m, t, st.Key) })
		if res.Out.Status == txn.OutOK {
			ev.Result = trace.ScanResult{Rows: res.Rows, Count: res.Count, Sum: res.Sum}
			t.Vars[st.As] = dsl.Binding{Value: res.Count, Count: res.Count, Sum: res.Sum}
			tr.ops = append(tr.ops, oracle.Op{Kind: "SCAN", Key: st.Key, Where: st.Where, As: st.As, Rows: res.Rows})
		}
	case "PUT", "DELETE":
		var v int64
		if st.Op == "PUT" {
			var err error
			v, err = st.Expr.Eval(txnEnv{t})
			if err != nil {
				res.Effects = r.m.Abort(t, trace.AbortRuntimeError)
				res.Out = txn.Outcome{Status: txn.OutAborted, Reason: trace.AbortRuntimeError}
				break
			}
			ev.Args.Value = &v
		}
		res = r.hooked(t, r.m.Put(t, st.Key, v, st.Op == "DELETE", resumed), func() txn.Hook { return r.m.SSI.OnWrite(r.m, t, st.Key) })
		if res.Out.Status == txn.OutOK {
			tr.ops = append(tr.ops, oracle.Op{Kind: st.Op, Key: st.Key, Expr: st.Expr})
		}
	case "COMMIT":
		res = r.m.Commit(t)
	case "ABORT":
		res = r.m.UserAbort(t)
	}
	ev.Reads = append(ev.Reads, res.Reads...)
	ev.Effects = append(ev.Effects, res.Effects...)
	switch res.Out.Status {
	case txn.OutOK:
		ev.Status = trace.StOK
	case txn.OutBlocked:
		ev.Status, ev.BlockedOn, ev.Reason = trace.StBlocked, res.Out.BlockedOn, res.Out.Reason
	case txn.OutAborted:
		ev.Status, ev.Reason = trace.StAborted, res.Out.Reason
	}
	r.push(ev, t)
	return res.Out
}

func (r *runner) hooked(t *txn.Txn, res txn.Result, f func() txn.Hook) txn.Result {
	if r.level != trace.SER || res.Out.Status != txn.OutOK {
		return res
	}
	h := f()
	res.Effects = append(res.Effects, h.Effects...)
	if h.AbortSelf {
		res.Effects = append(res.Effects, r.m.Abort(t, trace.AbortDependencies)...)
		res.Out = txn.Outcome{Status: txn.OutAborted, Reason: trace.AbortDependencies}
	}
	return res
}

func b2i(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

func sortedTxnIDs(m map[string]*txn.Txn) []string {
	ids := make([]string, 0, len(m))
	for id := range m {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
