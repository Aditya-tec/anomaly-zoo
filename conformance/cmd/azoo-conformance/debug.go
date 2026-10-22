package main

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/Aditya-tec/anomaly-zoo/conformance"
	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/gen"
	"github.com/Aditya-tec/anomaly-zoo/engine/oracle"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

// debugPad is the filler-row count for the page-granularity control (-pad).
var debugPad int

// debugCase runs one case n times and prints the engine history and each
// distinct PostgreSQL history. spec is "seed-N" or a path to an .azs file.
func debugCase(ctx context.Context, dsn, spec, level string, n int) error {
	sc, err := loadCase(spec)
	if err != nil {
		return err
	}
	lv := trace.Level(level)
	fmt.Println(dsl.Format(sc))
	eng, _, err := conformance.RunEngine(sc, lv)
	if err != nil {
		return err
	}
	if os.Getenv("AZOO_EVENTS") != "" {
		if err := printEvents(sc, lv); err != nil {
			return err
		}
	}
	fmt.Println("ENGINE:")
	fmt.Println(conformance.Describe(sc, eng))
	r, err := conformance.NewRunner(ctx, dsn, "az_dbg")
	if err != nil {
		return err
	}
	defer r.Close(ctx)
	r.Pad = debugPad
	seen := map[string]int{}
	var order []string
	hist := map[string]*conformance.History{}
	for i := 0; i < n; i++ {
		h, err := r.Run(ctx, sc, lv)
		if err != nil {
			return err
		}
		fp := conformance.Fingerprint(h)
		if _, ok := seen[fp]; !ok {
			order = append(order, fp)
			hist[fp] = h
		}
		seen[fp]++
	}
	for i, fp := range order {
		h := hist[fp]
		fmt.Printf("POSTGRES variant %d (%d/%d runs): diffs vs engine: %v\n", i+1, seen[fp], n, conformance.Diff(eng, h))
		fmt.Println(conformance.Describe(sc, h))
	}
	return nil
}

// printEvents dumps the engine's events with their lock effects.
func printEvents(sc *dsl.Scenario, lv trace.Level) error {
	_, tr, err := conformance.RunEngine(sc, lv)
	if err != nil {
		return err
	}
	for _, e := range tr.Steps {
		fmt.Printf("ev%-3d sched=%-3d %s %-6s %-8s %s", e.Index, e.ScheduledIndex, e.Txn, e.Op, e.Status, e.Reason)
		if e.BlockedOn != "" {
			fmt.Printf(" blockedOn=%s", e.BlockedOn)
		}
		for _, f := range e.Effects {
			if f.Kind == "rw_edge" || f.Kind == "doomed" {
				fmt.Printf(" [%s %s->%s via=%s key=%s txn=%s reason=%s]", f.Kind, f.From, f.To, f.Via, f.Key, f.Txn, f.Reason)
				continue
			}
			fmt.Printf(" [%s txn=%s key=%s holder=%s reason=%s]", f.Kind, f.Txn, f.Key, f.Holder, f.Reason)
		}
		fmt.Println()
	}
	return nil
}

// shrinkCase minimises spec to the smallest schedule on which PostgreSQL
// disagrees with the engine in every one of `runs` consecutive runs.
func shrinkCase(ctx context.Context, dsn, spec, level, kind string, runs int) error {
	sc, err := loadCase(spec)
	if err != nil {
		return err
	}
	lv := trace.Level(level)
	r, err := conformance.NewRunner(ctx, dsn, "az_shrink")
	if err != nil {
		return err
	}
	defer r.Close(ctx)
	fails := func(c *dsl.Scenario) bool {
		eng, _, err := conformance.RunEngine(c, lv)
		if err != nil {
			return false
		}
		for i := 0; i < runs; i++ {
			pg, err := r.Run(ctx, c, lv)
			if err != nil || !conformance.Mismatch(eng, pg) {
				return false
			}
			if kind != "" && conformance.KindOf(eng, pg) != kind {
				return false
			}
			if pg.RaceRisk {
				return false // minimal schedules for the non-race kinds must not need two blocked statements
			}
		}
		return true
	}
	if !fails(sc) {
		return fmt.Errorf("%s does not mismatch %d times in a row at %s", spec, runs, level)
	}
	small := oracle.Shrink(sc, fails)
	fmt.Println(dsl.Format(small))
	return nil
}

// loadCase accepts "seed-N" (the P8 generator) or a path to an .azs file.
func loadCase(spec string) (*dsl.Scenario, error) {
	if strings.HasPrefix(spec, "seed-") {
		seed, err := strconv.ParseUint(strings.TrimPrefix(spec, "seed-"), 10, 64)
		if err != nil {
			return nil, err
		}
		return gen.Generate(seed, gen.Config{NoDelete: true}), nil
	}
	src, err := readFile(spec)
	if err != nil {
		return nil, err
	}
	sc, errs := dsl.Parse(src)
	if len(errs) > 0 {
		return nil, fmt.Errorf("%v", errs)
	}
	return sc, nil
}

// explainExtra lists, for every transaction the engine aborted and PostgreSQL did not, how the
// engine's abort came about (doomed earlier or at the executing step), where, and what the
// transaction's script does afterwards. Investigation aid for docs/METHODOLOGY.md.
func explainExtra(ctx context.Context, dsn, spec string) error {
	sc, err := loadCase(spec)
	if err != nil {
		return err
	}
	_, tr, err := conformance.RunEngine(sc, trace.SER)
	if err != nil {
		return err
	}
	eng := conformance.FromTrace(sc, tr)
	r, err := conformance.NewRunner(ctx, dsn, "az_expl")
	if err != nil {
		return err
	}
	defer r.Close(ctx)
	pg, err := r.Run(ctx, sc, trace.SER)
	if err != nil {
		return err
	}
	pgAb := pg.SystemAborts()
	for id, cls := range eng.SystemAborts() {
		if _, both := pgAb[id]; both {
			continue
		}
		doomedBy, doomedAt := "", -1
		abortAt, abortOp, reason := -1, "", ""
		for _, e := range tr.Steps {
			for _, f := range e.Effects {
				if f.Kind == "doomed" && f.Txn == id && doomedAt < 0 {
					doomedAt, doomedBy = e.ScheduledIndex, e.Txn+" "+e.Op
				}
			}
			if e.Txn == id && e.Status == trace.StAborted && e.Reason != trace.AbortUser {
				abortAt, abortOp, reason = e.ScheduledIndex, e.Op, e.Reason
			}
		}
		var later []string
		for i := abortAt + 1; i < len(sc.Steps); i++ {
			if sc.Steps[i].Txn == id {
				later = append(later, sc.Steps[i].Op)
			}
		}
		fmt.Printf("%s: engine-only abort of %s (%s): reason=%s at step %d (%s); doomed=%v", spec, id, cls, reason, abortAt, abortOp, doomedAt >= 0)
		if doomedAt >= 0 {
			fmt.Printf(" at step %d by %s", doomedAt, doomedBy)
		}
		fmt.Printf("; later steps of %s in the script: %v; PostgreSQL: txn %s ended %s\n", id, later, id, describeEnd(pg, id))
	}
	return nil
}

func describeEnd(h *conformance.History, id string) string {
	o := h.Txns[id]
	switch {
	case o.Committed:
		return "committed"
	case o.Abort == conformance.ClassUser:
		return "by its scripted ABORT"
	default:
		return "aborted (" + o.Abort + ")"
	}
}

// verifyRules re-derives spec 4.8 (dangerous structure, victim) and 4.6 (first-updater-wins) from the
// edges and commits recorded in the engine's trace, independently of the engine's code, for every
// engine-initiated abort in the case, and prints PASS or FAIL for each.
func verifyRules(spec string) error {
	sc, err := loadCase(spec)
	if err != nil {
		return err
	}
	_, tr, err := conformance.RunEngine(sc, trace.SER)
	if err != nil {
		return err
	}
	edges := map[[2]string]bool{}
	commitTS := map[string]uint64{}
	aborted := map[string]bool{}
	snap := map[string]uint64{}
	for _, t := range tr.Txns {
		snap[t.ID] = t.SnapshotTS
	}
	committed := func(id string) bool { _, ok := commitTS[id]; return ok }
	// dangerous returns (I, O) for pivot p per spec 4.8, or "".
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
	seen := map[string]bool{}
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
			}
		}
		for _, f := range e.Effects {
			if f.Kind == "abort" && f.Reason == trace.AbortDependencies && !seen[f.Txn] {
				seen[f.Txn] = true
				victims = append(victims, f.Txn)
			}
		}
		for _, v := range victims {
			if seen["d"+v] {
				continue
			}
			seen["d"+v] = true
			// the victim is the pivot if it is one, else the I of some other pivot P that is not active
			found := ""
			if i, o := dangerous(v); i != "" {
				found = fmt.Sprintf("pivot %s (in-edge from %s, out-edge to %s, %s committed first at ts %d)", v, i, o, o, commitTS[o])
			} else {
				for p := range map[string]bool{"T1": true, "T2": true, "T3": true, "T4": true, "T5": true, "T6": true} {
					if i, o := dangerous(p); i == v && !(commitTS[p] == 0 && !aborted[p]) {
						found = fmt.Sprintf("in-edge source %s of committed/aborted pivot %s (out-edge to %s)", v, p, o)
					}
				}
			}
			status := "FAIL"
			if found != "" {
				status = "PASS"
			}
			fmt.Printf("%s %s step %d: %s dependency abort of %s: %s\n", spec, e.Txn+" "+e.Op, e.ScheduledIndex, status, v, found)
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
			if f.Kind == "abort" && f.Reason == trace.AbortConcurrentUpdate {
				// 4.6: at the moment the lock was acquired, the key's newest committed version was newer than the snapshot.
				fmt.Printf("%s %s step %d: first-updater-wins abort of %s (snapshot ts %d) on key %s: ", spec, e.Txn+" "+e.Op, e.ScheduledIndex, f.Txn, snap[f.Txn], e.Args.Key)
				var newest uint64
				for _, w := range tr.Steps {
					if w.Index >= e.Index {
						break
					}
					for _, g := range w.Effects {
						if g.Kind == "commit" {
							for _, kv := range w.StoreAfter {
								if kv.Key == e.Args.Key {
									for _, v := range kv.Versions {
										if v.Writer == g.Txn && v.CommitTS > newest {
											newest = v.CommitTS
										}
									}
								}
							}
						}
					}
				}
				verdict := "FAIL"
				if newest > snap[f.Txn] {
					verdict = "PASS"
				}
				fmt.Printf("newest committed version ts %d: %s\n", newest, verdict)
			}
		}
	}
	return nil
}

// controls runs two control experiments on a case at SER and prints, for each variant, in how many of
// 8 PostgreSQL runs the history differed from the engine's:
//  1. ro-write <T>: transaction T never writes; a harmless write (key w:9) is inserted immediately
//     before its first data operation, so it is no longer read-only and its snapshot moment is unchanged.
//  2. abort->commit <T>: the scripted final ABORT of T becomes a COMMIT.
func controls(ctx context.Context, dsn, spec string) error {
	base, err := loadCase(spec)
	if err != nil {
		return err
	}
	r, err := conformance.NewRunner(ctx, dsn, "az_ctl")
	if err != nil {
		return err
	}
	defer r.Close(ctx)
	const runs = 8
	measure := func(sc *dsl.Scenario) (string, error) {
		eng, _, err := conformance.RunEngine(sc, trace.SER)
		if err != nil {
			return "", err
		}
		differ := 0
		first := ""
		for i := 0; i < runs; i++ {
			pg, err := r.Run(ctx, sc, trace.SER)
			if err != nil {
				return "", err
			}
			if df := conformance.Diff(eng, pg); len(df) > 0 {
				differ++
				if first == "" {
					first = fmt.Sprintf("; kind=%s; PG aborts %v; first diff: %s", conformance.KindOf(eng, pg), pg.SystemAborts(), df[0])
				}
			}
		}
		return fmt.Sprintf("PostgreSQL differs from the engine in %d of %d runs (engine aborts %v)%s", differ, runs, eng.SystemAborts(), first), nil
	}
	res, err := measure(base)
	if err != nil {
		return err
	}
	fmt.Printf("%s baseline: %s\n", spec, res)
	ids := map[string]bool{}
	writes := map[string]bool{}
	for _, st := range base.Steps {
		ids[st.Txn] = true
		if st.Op == "PUT" || st.Op == "DELETE" {
			writes[st.Txn] = true
		}
	}
	for id := range ids {
		if !writes[id] {
			v := cloneScenario(base)
			var steps []dsl.Step
			done := false
			for _, st := range v.Steps {
				if !done && st.Txn == id && (st.Op == "READ" || st.Op == "SCAN") {
					steps = append(steps, dsl.Step{Txn: id, Op: "PUT", Key: "w:9", Expr: &dsl.Expr{Terms: []dsl.SignedTerm{{Term: dsl.Term{Coef: 1}}}}})
					done = true
				}
				steps = append(steps, st)
			}
			v.Steps = steps
			parsed, errs := dsl.Parse(dsl.Format(v))
			if len(errs) > 0 {
				return fmt.Errorf("%v", errs)
			}
			res, err := measure(parsed)
			if err != nil {
				return err
			}
			fmt.Printf("%s ro-write %s: %s\n", spec, id, res)
		}
	}
	for i := len(base.Steps) - 1; i >= 0; i-- {
		st := base.Steps[i]
		if st.Op == "ABORT" {
			v := cloneScenario(base)
			v.Steps[i].Op = "COMMIT"
			parsed, errs := dsl.Parse(dsl.Format(v))
			if len(errs) > 0 {
				return fmt.Errorf("%v", errs)
			}
			res, err := measure(parsed)
			if err != nil {
				return err
			}
			fmt.Printf("%s abort->commit %s: %s\n", spec, st.Txn, res)
		}
	}
	return nil
}

func cloneScenario(sc *dsl.Scenario) *dsl.Scenario {
	c := *sc
	c.Steps = append([]dsl.Step(nil), sc.Steps...)
	c.Setup = append([]dsl.SetupPut(nil), sc.Setup...)
	return &c
}

// hintsFor prints the hints SERHints finds for a case (investigation aid).
func hintsFor(ctx context.Context, dsn, spec string) error {
	sc, err := loadCase(spec)
	if err != nil {
		return err
	}
	eng, tr, err := conformance.RunEngine(sc, trace.SER)
	if err != nil {
		return err
	}
	r, err := conformance.NewRunner(ctx, dsn, "az_hint")
	if err != nil {
		return err
	}
	defer r.Close(ctx)
	pg, err := r.Run(ctx, sc, trace.SER)
	if err != nil {
		return err
	}
	h, err := conformance.SERHints(ctx, r, sc, tr, eng.SystemAborts(), pg.SystemAborts())
	fmt.Printf("%s: engine %v, postgres %v, hints %v, err %v, structures %+v\n", spec, eng.SystemAborts(), pg.SystemAborts(), h, err, conformance.VictimStructures(tr))
	return nil
}

// hintDetail prints, for every control variant of a full schedule, the engine's and PostgreSQL's abort sets.
func hintDetail(ctx context.Context, dsn, spec string) error {
	sc, err := loadCase(spec)
	if err != nil {
		return err
	}
	r, err := conformance.NewRunner(ctx, dsn, "az_hintd")
	if err != nil {
		return err
	}
	defer r.Close(ctx)
	show := func(label string, v *dsl.Scenario, pad int) error {
		eng, _, err := conformance.RunEngine(v, trace.SER)
		if err != nil {
			return err
		}
		r.Pad = pad
		defer func() { r.Pad = 0 }()
		seen := map[string]int{}
		for i := 0; i < 3; i++ {
			pg, err := r.Run(ctx, v, trace.SER)
			if err != nil {
				return err
			}
			seen[fmt.Sprint(pg.SystemAborts())]++
		}
		fmt.Printf("%s %-26s engine %v  PostgreSQL %v\n", spec, label, eng.SystemAborts(), seen)
		return nil
	}
	if err := show("baseline", sc, 0); err != nil {
		return err
	}
	if err := show("padded", sc, 3000); err != nil {
		return err
	}
	ids := map[string]bool{}
	writes := map[string]bool{}
	for _, st := range sc.Steps {
		ids[st.Txn] = true
		if st.Op == "PUT" || st.Op == "DELETE" {
			writes[st.Txn] = true
		}
	}
	for id := range ids {
		if !writes[id] {
			if v, ok := conformance.WithWrite(sc, id); ok {
				if err := show("write added to "+id, v, 0); err != nil {
					return err
				}
			}
		}
		if v, ok := conformance.AbortToCommit(sc, id); ok {
			if err := show("ABORT->COMMIT "+id, v, 0); err != nil {
				return err
			}
		}
	}
	return nil
}

// abortSteps prints the statement at which each side aborts each transaction (full schedule).
func abortSteps(ctx context.Context, dsn, spec string) error {
	sc, err := loadCase(spec)
	if err != nil {
		return err
	}
	eng, _, err := conformance.RunEngine(sc, trace.SER)
	if err != nil {
		return err
	}
	r, err := conformance.NewRunner(ctx, dsn, "az_steps")
	if err != nil {
		return err
	}
	defer r.Close(ctx)
	pg, err := r.Run(ctx, sc, trace.SER)
	if err != nil {
		return err
	}
	line := func(h *conformance.History) string {
		out := ""
		for i, s := range h.Steps {
			if s.Status == "aborted" {
				out += fmt.Sprintf("%s at step %d (%s)  ", s.Txn, i, s.Op)
			}
		}
		if out == "" {
			return "none"
		}
		return out
	}
	fmt.Printf("%s | engine aborts: %s| PostgreSQL aborts: %s\n", spec, line(eng), line(pg))
	return nil
}
