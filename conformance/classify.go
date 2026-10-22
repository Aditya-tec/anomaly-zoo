package conformance

import (
	"context"
	"sort"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/oracle"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

// Hints name the control experiment that makes PostgreSQL agree with the engine on a Serializable
// schedule where the engine aborts more than PostgreSQL and no waiter race is involved. They are
// evidence, not guesses: each is the result of re-running a variant of the schedule on PostgreSQL.
const (
	// HintPageLocks: putting 3,000 filler rows between the keys (so they cannot share an index page) makes PostgreSQL agree.
	HintPageLocks = "page-locks"
	// HintNoWritesIn: a transaction that writes nothing takes part in the dangerous structure; giving it one
	// harmless write (before its first data operation) makes PostgreSQL agree.
	HintNoWritesIn = "no-writes-in-edge"
	// HintErrorDeferred: a transaction the engine aborts at its next statement ends by its own ABORT in the
	// script; turning that ABORT into a COMMIT makes PostgreSQL abort the same transactions as the engine.
	HintErrorDeferred = "error-deferred-to-commit"
	// HintInRolledBack: every engine-only abort is the pivot of a dangerous structure whose in-edge
	// transaction ends by its own ABORT. No control explains why PostgreSQL does not abort the pivot.
	HintInRolledBack = "in-transaction-rolled-back"
)

// Structure is the dangerous structure the engine's trace shows at the moment a transaction is doomed or aborted
// for abort_dependencies (spec 4.8), re-derived from the recorded rw-edges and commits.
type Structure struct {
	Victim, Pivot, In, Out string
}

// VictimStructures re-derives spec 4.8 from the edges and commits recorded in tr, independently of the
// engine's code, for every transaction aborted with abort_dependencies. A victim with no structure found is omitted.
func VictimStructures(tr *trace.Trace) map[string]Structure {
	edges := map[[2]string]bool{}
	commitTS := map[string]uint64{}
	aborted := map[string]bool{}
	committed := func(id string) bool { _, ok := commitTS[id]; return ok }
	dangerous := func(p string) (string, string) {
		for e1 := range edges {
			if e1[1] != p || aborted[e1[0]] {
				continue
			}
			for e2 := range edges {
				if e2[0] != p || aborted[e2[1]] {
					continue
				}
				i, o := e1[0], e2[1]
				if !committed(o) {
					continue
				}
				ok := true
				for _, x := range []string{i, p} {
					if x != o && committed(x) && commitTS[x] < commitTS[o] {
						ok = false
					}
				}
				if ok {
					return i, o
				}
			}
		}
		return "", ""
	}
	out := map[string]Structure{}
	for _, e := range tr.Steps {
		var victims []string
		for _, f := range e.Effects {
			switch f.Kind {
			case "rw_edge":
				if !aborted[f.From] && !aborted[f.To] {
					edges[[2]string{f.From, f.To}] = true
				}
			case "commit":
				commitTS[f.Txn] = f.CommitTS
			case "doomed":
				victims = append(victims, f.Txn)
			case "abort":
				if f.Reason == trace.AbortDependencies {
					victims = append(victims, f.Txn)
				}
			}
		}
		for _, v := range victims {
			if _, done := out[v]; done {
				continue
			}
			if i, o := dangerous(v); i != "" {
				out[v] = Structure{Victim: v, Pivot: v, In: i, Out: o}
				continue
			}
			for _, p := range []string{"T1", "T2", "T3", "T4", "T5", "T6"} {
				if i, o := dangerous(p); i == v {
					out[v] = Structure{Victim: v, Pivot: p, In: i, Out: o}
				}
			}
		}
		for _, f := range e.Effects {
			if f.Kind == "abort" {
				aborted[f.Txn] = true
				for k := range edges {
					if k[0] == f.Txn || k[1] == f.Txn {
						delete(edges, k)
					}
				}
			}
		}
	}
	return out
}

func reparse(sc *dsl.Scenario) (*dsl.Scenario, bool) {
	p, errs := dsl.Parse(dsl.Format(sc))
	return p, len(errs) == 0
}

func cloneSteps(sc *dsl.Scenario) *dsl.Scenario {
	c := *sc
	c.Steps = append([]dsl.Step(nil), sc.Steps...)
	c.Setup = append([]dsl.SetupPut(nil), sc.Setup...)
	return &c
}

// WithWrite returns sc with a harmless write (key w:9) by txn inserted immediately before its first read or scan.
func WithWrite(sc *dsl.Scenario, txn string) (*dsl.Scenario, bool) {
	v := cloneSteps(sc)
	var steps []dsl.Step
	done := false
	for _, st := range v.Steps {
		if !done && st.Txn == txn && (st.Op == "READ" || st.Op == "SCAN") {
			steps = append(steps, dsl.Step{Txn: txn, Op: "PUT", Key: "w:9", Expr: &dsl.Expr{Terms: []dsl.SignedTerm{{Term: dsl.Term{Coef: 1}}}}})
			done = true
		}
		steps = append(steps, st)
	}
	if !done {
		return nil, false
	}
	v.Steps = steps
	return reparse(v)
}

// AbortToCommit returns sc with the scripted ABORT of txn turned into a COMMIT.
func AbortToCommit(sc *dsl.Scenario, txn string) (*dsl.Scenario, bool) {
	v := cloneSteps(sc)
	for i := len(v.Steps) - 1; i >= 0; i-- {
		if v.Steps[i].Txn == txn && v.Steps[i].Op == "ABORT" {
			v.Steps[i].Op = "COMMIT"
			return reparse(v)
		}
	}
	return nil, false
}

// pgNowAborts reports whether, in each of runs PostgreSQL runs of sc, PostgreSQL aborts at least one of the
// transactions in want while the engine also aborts it in sc (the variant). It is how a control "moves"
// PostgreSQL's answer on a full schedule that may carry several causes at once.
func pgNowAborts(ctx context.Context, r *Runner, sc *dsl.Scenario, want []string, runs int) (bool, error) {
	eng, _, err := RunEngine(sc, trace.SER)
	if err != nil {
		return false, err
	}
	ea := eng.SystemAborts()
	var cand []string
	for _, id := range want {
		if _, ok := ea[id]; ok {
			cand = append(cand, id)
		}
	}
	if len(cand) == 0 {
		return false, nil
	}
	hit := map[string]int{}
	for i := 0; i < runs; i++ {
		pg, err := r.Run(ctx, sc, trace.SER)
		if err != nil {
			return false, err
		}
		pa := pg.SystemAborts()
		for _, id := range cand {
			if _, ok := pa[id]; ok {
				hit[id]++
			}
		}
	}
	for _, id := range cand {
		if hit[id] == runs {
			return true, nil
		}
	}
	return false, nil
}

// SERHints runs the control experiments for a Serializable schedule on which the engine aborts more than
// PostgreSQL and no waiters raced, and returns the hints (in precedence order) that apply. engineAborts is
// the engine's set of system-aborted transactions and pgAborts PostgreSQL's. A control applies when it makes
// PostgreSQL abort a transaction the engine aborted and PostgreSQL did not (the "extra" set) in every run.
func SERHints(ctx context.Context, r *Runner, sc *dsl.Scenario, tr *trace.Trace, engineAborts, pgAborts map[string]string) ([]string, error) {
	const runs = 3
	var hints []string
	var extra []string
	for id := range engineAborts {
		if _, both := pgAborts[id]; !both {
			extra = append(extra, id)
		}
	}
	sort.Strings(extra)
	if len(extra) == 0 {
		return nil, nil
	}

	// 1. page-level read locks: filler rows keep the keys on different index pages.
	old := r.Pad
	r.Pad = 3000
	ok, err := pgNowAborts(ctx, r, sc, extra, runs)
	r.Pad = old
	if err != nil {
		return nil, err
	}
	if ok {
		hints = append(hints, HintPageLocks)
	}

	// 2. a transaction that writes nothing.
	ids := map[string]bool{}
	writes := map[string]bool{}
	for _, st := range sc.Steps {
		ids[st.Txn] = true
		if st.Op == "PUT" || st.Op == "DELETE" {
			writes[st.Txn] = true
		}
	}
	var readers []string
	for id := range ids {
		if !writes[id] {
			readers = append(readers, id)
		}
	}
	sort.Strings(readers)
	for _, id := range readers {
		v, ok := WithWrite(sc, id)
		if !ok {
			continue
		}
		moved, err := pgNowAborts(ctx, r, v, extra, runs)
		if err != nil {
			return nil, err
		}
		if moved {
			hints = append(hints, HintNoWritesIn)
			break
		}
	}

	// 3. an engine-only abort of a transaction that then rolls back by its own script: with that
	// rollback turned into a commit PostgreSQL aborts the same transaction.
	for _, id := range extra {
		scripted := false
		for _, st := range sc.Steps {
			if st.Txn == id && st.Op == "ABORT" {
				scripted = true
			}
		}
		if !scripted {
			continue
		}
		v, ok := AbortToCommit(sc, id)
		if !ok {
			continue
		}
		moved, err := pgNowAborts(ctx, r, v, []string{id}, runs)
		if err != nil {
			return nil, err
		}
		if moved {
			hints = append(hints, HintErrorDeferred)
			break
		}
	}

	// 4. every engine-only abort is a pivot whose in-edge transaction ends by its own ABORT.
	structs := VictimStructures(tr)
	all := true
	for _, id := range extra {
		s, ok := structs[id]
		if !ok || s.Pivot != id || !endsByAbort(sc, s.In) {
			all = false
		}
	}
	if all {
		hints = append(hints, HintInRolledBack)
	}
	return hints, nil
}

func endsByAbort(sc *dsl.Scenario, txn string) bool {
	for i := len(sc.Steps) - 1; i >= 0; i-- {
		if sc.Steps[i].Txn == txn && (sc.Steps[i].Op == "ABORT" || sc.Steps[i].Op == "COMMIT") {
			return sc.Steps[i].Op == "ABORT"
		}
	}
	return false
}

// maxShrinkEvals bounds the PostgreSQL-backed shrink of one mismatch (each candidate costs `runs` PostgreSQL runs).
const maxShrinkEvals = 400

// ShrinkMismatch minimises sc while PostgreSQL keeps showing the same kind of Serializable difference
// (the engine aborts more, no waiters raced) in each of `runs` consecutive runs. If the schedule does not
// show it that consistently to begin with, it is returned unchanged.
func ShrinkMismatch(ctx context.Context, r *Runner, sc *dsl.Scenario, runs int) *dsl.Scenario {
	evals := 0
	fails := func(c *dsl.Scenario) bool {
		if evals >= maxShrinkEvals {
			return false
		}
		evals++
		eng, _, err := RunEngine(c, trace.SER)
		if err != nil {
			return false
		}
		for i := 0; i < runs; i++ {
			pg, err := r.Run(ctx, c, trace.SER)
			if err != nil || pg.RaceRisk || !Mismatch(eng, pg) || KindOf(eng, pg) != "more" {
				return false
			}
		}
		return true
	}
	if !fails(sc) {
		return sc
	}
	return oracle.Shrink(sc, fails)
}
