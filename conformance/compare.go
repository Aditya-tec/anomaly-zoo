package conformance

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/matrix"
	"github.com/Aditya-tec/anomaly-zoo/engine/run"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

// Levels is the set compared against PostgreSQL (spec §9.4: RC, SI, SER only).
var Levels = []trace.Level{trace.RC, trace.SI, trace.SER}

// RerunMatchedRace re-runs schedules with simultaneous blocking even when the
// first run agreed with the engine, to measure PostgreSQL's variation. The
// nightly shards switch it off: they re-run actual mismatches only.
var RerunMatchedRace = true

// Reruns is how often every mismatch is re-run against PostgreSQL;
// RaceReruns is the longer series used when two statements waited for the same
// key (PostgreSQL itself varies there, so more runs are needed to see which
// outcomes it can produce).
const (
	Reruns     = 5
	RaceReruns = 30
)

// Case is one schedule to compare.
type Case struct {
	Name   string
	Canned bool
	SC     *dsl.Scenario
}

// Cell is the headline outcome of one (scenario, level) on one side.
type Cell struct {
	Invariant    string            `json:"invariant"`
	Serializable bool              `json:"serializable"`
	Aborts       map[string]string `json:"aborts"`
	Mechanism    string            `json:"mechanism"`
}

// Eval is the full comparison of one case at one level.
type Eval struct {
	Case  string
	Level trace.Level

	Engine, PG     *History
	EngineSer      bool
	PGSer          bool
	EngineCell     Cell
	PGCell         Cell
	Diffs          []string // strict differences (all levels)
	DeadlockAgreed bool     // both sides deadlocked: only the outcome class is compared
	Deadlock       bool     // either side deadlocked

	Mismatch     bool     // counts against the level (see Classify)
	Rerun        []string // fingerprint of each re-run's PG history
	Unstable     bool     // some re-run's PG history differed from the first
	RerunMatches int      // re-runs whose comparison agreed with the engine
	RaceRisk     bool     // two statements were blocked at the same time (any run)
	Hints        []string // SER only: control experiments that make PostgreSQL agree (see classify.go)
	Shrunk       string   // SER only: the minimal schedule the hints were computed on (.azs source)
	Variants     int      // distinct PostgreSQL histories over all runs of this evaluation
}

// RunEngine executes sc at level and converts the trace.
func RunEngine(sc *dsl.Scenario, level trace.Level) (*History, *trace.Trace, error) {
	tr, err := run.Run(sc, level)
	if err != nil {
		return nil, nil, err
	}
	return FromTrace(sc, tr), tr, nil
}

// pgEnv evaluates invariants on a PostgreSQL history.
type pgEnv struct{ h *History }

func (e pgEnv) Var(n string) (dsl.Binding, bool) {
	for _, id := range e.h.TxnIDs() {
		if b, ok := e.h.vars[id][n]; ok {
			return b, true
		}
	}
	return dsl.Binding{}, false
}

func (e pgEnv) FinalVal(k string) int64 {
	for _, kv := range e.h.Final {
		if kv.Key == k {
			return kv.Value
		}
	}
	return 0
}

func (e pgEnv) FinalCount(prefix string, w *dsl.Where) int64 {
	var n int64
	for _, kv := range e.h.Final {
		if strings.HasPrefix(kv.Key, prefix) && (w == nil || dsl.Compare(w.Cmp, kv.Value, w.Value)) {
			n++
		}
	}
	return n
}

func (e pgEnv) FinalSum(prefix string) int64 {
	var s int64
	for _, kv := range e.h.Final {
		if strings.HasPrefix(kv.Key, prefix) {
			s += kv.Value
		}
	}
	return s
}

func (e pgEnv) Committed(id string) bool { return e.h.Txns[id].Committed }

// pgMechanism names the abort the way the engine's reason codes do, going by
// the text of PostgreSQL's error.
func pgMechanism(o TxnOutcome) string {
	switch o.Abort {
	case ClassDeadlock:
		return trace.AbortDeadlock
	case ClassSerialization:
		switch {
		case strings.Contains(o.Reason, "concurrent update"):
			return trace.AbortConcurrentUpdate
		case strings.Contains(o.Reason, "read/write dependencies"):
			return trace.AbortDependencies
		}
		return "abort_serialization_other"
	}
	return "abort_" + o.Abort
}

// PGCell summarises a PostgreSQL history for scenario sc the way matrix.CellOf
// does for an engine trace.
func PGCell(sc *dsl.Scenario, h *History, ser bool) Cell {
	c := Cell{Invariant: "n/a", Serializable: ser, Aborts: map[string]string{}, Mechanism: "none"}
	holds, violated := 0, 0
	for i := range sc.Invariants {
		switch dsl.EvalInvariant(&sc.Invariants[i], pgEnv{h}).Status {
		case dsl.InvHolds:
			holds++
		case dsl.InvViolated:
			violated++
		}
	}
	switch {
	case violated > 0:
		c.Invariant = "violated"
	case holds > 0:
		c.Invariant = "holds"
	}
	ids := []string{}
	for id, cls := range h.SystemAborts() {
		_ = cls
		c.Aborts[id] = pgMechanism(h.Txns[id])
		ids = append(ids, id)
	}
	sort.Strings(ids)
	switch {
	case len(ids) > 0:
		c.Mechanism = c.Aborts[ids[0]]
	case c.Invariant == "holds":
		c.Mechanism = "visibility"
	}
	return c
}

// Fingerprint is a canonical one-line form of everything that is compared.
func Fingerprint(h *History) string {
	var b strings.Builder
	for i, s := range h.Steps {
		fmt.Fprintf(&b, "%d:%s/%s/%s/%s/%s/%s|", i, s.Txn, s.Op, s.Status, s.Abort, fmtRead(s.Read), fmtRows(s.Rows))
		if s.Wrote != nil {
			fmt.Fprintf(&b, "w%d|", *s.Wrote)
		}
	}
	b.WriteString(fmtRows(h.Final))
	b.WriteString(fmtAborts(h.SystemAborts()))
	return b.String()
}

// compare fills Diffs/Deadlock/Mismatch for one engine/PG pair.
func (e *Eval) compare() {
	e.Diffs = Diff(e.Engine, e.PG)
	e.Deadlock = e.Engine.HasDeadlock() || e.PG.HasDeadlock()
	e.DeadlockAgreed = e.Engine.HasDeadlock() && e.PG.HasDeadlock()
	switch {
	case e.Deadlock:
		// Outcome class only (spec §9.4): someone aborts with a deadlock, on both sides.
		e.Mismatch = !e.DeadlockAgreed || len(e.Engine.Anomalies)+len(e.PG.Anomalies) > 0
		if !e.DeadlockAgreed && len(e.Diffs) == 0 {
			e.Diffs = []string{"deadlock on one side only"}
		}
	default:
		e.Mismatch = len(e.Diffs) > 0
	}
}

// Evaluate runs c at level on PostgreSQL, compares with the engine and, when
// there is a mismatch, re-runs PostgreSQL Reruns times.
func Evaluate(ctx context.Context, r *Runner, c Case, level trace.Level) (*Eval, error) {
	eng, tr, err := RunEngine(c.SC, level)
	if err != nil {
		return nil, err
	}
	pg, err := r.Run(ctx, c.SC, level)
	if err != nil {
		return nil, fmt.Errorf("%s %s: %w", c.Name, level, err)
	}
	e := &Eval{Case: c.Name, Level: level, Engine: eng, PG: pg, EngineSer: tr.Serializable.Verdict}
	e.PGSer = pg.SerializablePG(tr.Setup)
	e.EngineCell = cellOfTrace(tr)
	e.PGCell = PGCell(c.SC, pg, e.PGSer)
	e.compare()
	e.RaceRisk = pg.RaceRisk
	e.Variants = 1
	if !e.Mismatch && !(level == trace.SER && e.abortsDiffer()) && !(pg.RaceRisk && RerunMatchedRace) {
		return e, nil
	}
	// Flake control: re-run against PostgreSQL before anything is classified.
	// Schedules where waiters raced are re-run too, even when the first run
	// agreed, to measure how much PostgreSQL itself varies.
	first := Fingerprint(pg)
	seen := map[string]bool{first: true}
	n := Reruns
	if pg.RaceRisk && e.Mismatch {
		n = RaceReruns
	}
	for i := 0; i < n; i++ {
		again, err := r.Run(ctx, c.SC, level)
		if err != nil {
			return nil, fmt.Errorf("%s %s rerun: %w", c.Name, level, err)
		}
		fp := Fingerprint(again)
		if again.RaceRisk {
			e.RaceRisk = true
		}
		seen[fp] = true
		e.Rerun = append(e.Rerun, fp)
		if fp != first {
			e.Unstable = true
		}
		x := &Eval{Engine: eng, PG: again}
		x.compare()
		if !x.Mismatch {
			e.RerunMatches++
		}
	}
	e.Variants = len(seen)
	e.addHints(ctx, r, c, tr)
	return e, nil
}

// addHints runs the control experiments for the one Serializable kind no divergence covers by shape
// (the engine aborts more than PostgreSQL, no waiters raced). A failure to run them leaves no hint.
func (e *Eval) addHints(ctx context.Context, r *Runner, c Case, tr *trace.Trace) {
	if e.Level != trace.SER || !e.Mismatch || e.RaceRisk || e.Deadlock || SERKind(e) != "more" {
		return
	}
	// The controls only mean something on a minimal schedule (on a full one several causes stack up and
	// padding has nowhere to put filler rows), so shrink first, then classify the shrunk schedule.
	small := ShrinkMismatch(ctx, r, c.SC, 3)
	eng, str, err := RunEngine(small, trace.SER)
	if err != nil {
		return
	}
	pg, err := r.Run(ctx, small, trace.SER)
	if err != nil {
		return
	}
	h, err := SERHints(ctx, r, small, str, eng.SystemAborts(), pg.SystemAborts())
	if err == nil {
		e.Hints = h
		e.Shrunk = dsl.Format(small)
	}
}

func (e *Eval) abortsDiffer() bool {
	return fmtAborts(e.Engine.SystemAborts()) != fmtAborts(e.PG.SystemAborts())
}

func cellOfTrace(tr *trace.Trace) Cell {
	c := matrix.CellOf(tr)
	return Cell{Invariant: c.Invariant, Serializable: c.Serializable, Aborts: c.Aborts, Mechanism: c.Mechanism}
}

// Mismatch reports whether an engine history and a PostgreSQL history differ
// in the sense of spec §9.4 (strictly, or by deadlock class for deadlock schedules).
func Mismatch(engine, pg *History) bool {
	e := &Eval{Engine: engine, PG: pg}
	e.compare()
	return e.Mismatch
}

// SERKind says how the abort sets of a SER evaluation relate: identical, more
// (the engine aborts more transactions than PostgreSQL), fewer, or same-count
// (different transactions, same number).
func SERKind(e *Eval) string {
	ne, np := len(e.Engine.SystemAborts()), len(e.PG.SystemAborts())
	switch {
	case !e.abortsDiffer():
		return "identical"
	case ne > np:
		return "more"
	case ne < np:
		return "fewer"
	}
	return "same-count"
}

// PGAbortReasons lists PostgreSQL's error text for every transaction it aborted.
func PGAbortReasons(e *Eval) []string {
	var out []string
	for _, id := range e.PG.TxnIDs() {
		if t := e.PG.Txns[id]; t.Reason != "" && t.Abort != ClassUser {
			out = append(out, id+": "+t.Reason)
		}
	}
	return out
}

// KindOf is SERKind for a bare pair of histories.
func KindOf(engine, pg *History) string {
	e := &Eval{Engine: engine, PG: pg}
	return SERKind(e)
}

// AbortsString renders a history's system-aborted transactions, e.g. {T1:serialization}.
func AbortsString(h *History) string { return fmtAborts(h.SystemAborts()) }
