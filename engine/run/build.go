package run

import (
	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/oracle"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
	"github.com/Aditya-tec/anomaly-zoo/engine/txn"
)

// finalEnv evaluates invariants against the end state of a run.
type finalEnv struct{ r *runner }

func (e finalEnv) Var(n string) (dsl.Binding, bool) {
	for _, id := range sortedTxnIDs(e.r.m.Txns) {
		if b, ok := e.r.m.Txns[id].Vars[n]; ok {
			return b, true
		}
	}
	return dsl.Binding{}, false
}

func (e finalEnv) live(k string) (int64, bool) {
	v, ok := e.r.m.Store.NewestCommitted(k)
	if !ok || v.Deleted {
		return 0, false
	}
	return v.Value, true
}

func (e finalEnv) FinalVal(k string) int64 { v, _ := e.live(k); return v }

func (e finalEnv) FinalCount(prefix string, w *dsl.Where) int64 {
	var n int64
	for _, k := range e.r.m.Store.KeysWithPrefix(prefix) {
		if v, ok := e.live(k); ok && (w == nil || dsl.Compare(w.Cmp, v, w.Value)) {
			n++
		}
	}
	return n
}

func (e finalEnv) FinalSum(prefix string) int64 {
	var s int64
	for _, k := range e.r.m.Store.KeysWithPrefix(prefix) {
		if v, ok := e.live(k); ok {
			s += v
		}
	}
	return s
}

func (e finalEnv) Committed(id string) bool {
	t := e.r.m.Txns[id]
	return t != nil && t.Status == txn.Committed
}

func (r *runner) finalState() []trace.KV {
	out := []trace.KV{}
	env := finalEnv{r}
	for _, k := range r.m.Store.Keys() {
		if v, ok := env.live(k); ok {
			out = append(out, trace.KV{Key: k, Value: v})
		}
	}
	return out
}

func (r *runner) build() (*trace.Trace, error) {
	sc := r.sc
	info := trace.ScenarioInfo{ID: sc.ID, Title: sc.Title, Story: sc.Story, Invariants: []trace.InvDecl{}}
	for i := range sc.Invariants {
		info.Invariants = append(info.Invariants, trace.InvDecl{Name: sc.Invariants[i].Name, Expr: sc.Invariants[i].FormatInvariantExpr()})
	}
	setup := []trace.KV{}
	for _, p := range sc.Setup {
		setup = append(setup, trace.KV{Key: p.Key, Value: p.Value})
	}
	events := r.events
	if events == nil {
		events = []trace.Event{}
	}

	summaries := []trace.TxnSummary{}
	var committed []oracle.Txn
	for _, id := range sortedTxnIDs(r.m.Txns) {
		t := r.m.Txns[id]
		s := trace.TxnSummary{ID: id, Status: "aborted", SnapshotTS: t.SnapshotTS, CommitTS: t.CommitTS}
		if t.Status == txn.Committed {
			s.Status = "committed"
			committed = append(committed, oracle.Txn{ID: id, Ops: r.txns[id].ops})
		} else {
			reason := t.AbortReason
			s.AbortReason = &reason
		}
		summaries = append(summaries, s)
	}

	final := r.finalState()
	invs := []trace.InvResult{}
	env := finalEnv{r}
	for i := range sc.Invariants {
		res := dsl.EvalInvariant(&sc.Invariants[i], env)
		invs = append(invs, trace.InvResult{Name: res.Name, Status: string(res.Status), Detail: res.Detail})
	}

	ok, order := oracle.Check(oracle.Input{Setup: setup, Txns: committed, Final: final})
	t := &trace.Trace{
		SchemaVersion: trace.SchemaVersion,
		EngineVersion: trace.EngineVersion,
		Scenario:      info,
		Level:         r.level,
		Setup:         setup,
		Steps:         events,
		Txns:          summaries,
		FinalState:    final,
		Invariants:    invs,
		Serializable:  trace.Serializable{Verdict: ok, WitnessOrder: order},
	}
	if err := t.Seal(); err != nil {
		return nil, err
	}
	return t, nil
}
