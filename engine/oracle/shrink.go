package oracle

import "github.com/Aditya-tec/anomaly-zoo/engine/dsl"

// Shrink greedily simplifies sc while fails keeps returning true: it deletes
// whole transactions, single steps, setup lines and WHERE filters, accepting
// a candidate only if it re-parses (so every static rule still holds). The
// result is a locally minimal scenario; print it with dsl.Format.
func Shrink(sc *dsl.Scenario, fails func(*dsl.Scenario) bool) *dsl.Scenario {
	cur := sc
	try := func(cand *dsl.Scenario) bool {
		parsed, errs := dsl.Parse(dsl.Format(cand))
		if len(errs) > 0 || !fails(parsed) {
			return false
		}
		cur = parsed
		return true
	}
	for progress := true; progress; {
		progress = false

		// Drop a whole transaction.
		for _, id := range txnIDs(cur) {
			cand := clone(cur)
			cand.Steps = nil
			for _, st := range cur.Steps {
				if st.Txn != id {
					cand.Steps = append(cand.Steps, st)
				}
			}
			if len(cand.Steps) > 0 && try(cand) {
				progress = true
			}
		}

		// Drop single steps.
		for i := 0; i < len(cur.Steps); i++ {
			op := cur.Steps[i].Op
			if op == "BEGIN" || op == "COMMIT" || op == "ABORT" {
				continue
			}
			cand := clone(cur)
			cand.Steps = append(append([]dsl.Step(nil), cur.Steps[:i]...), cur.Steps[i+1:]...)
			if try(cand) {
				progress = true
				i--
			}
		}

		// Turn an ABORT into nothing is not possible, but a COMMIT can become
		// an ABORT, which often removes dependencies.
		for i := range cur.Steps {
			if cur.Steps[i].Op != "COMMIT" {
				continue
			}
			cand := clone(cur)
			cand.Steps[i].Op = "ABORT"
			if try(cand) {
				progress = true
			}
		}

		// Replace computed PUT values by a constant, freeing the READs they used.
		for i := range cur.Steps {
			st := cur.Steps[i]
			if st.Op != "PUT" || (len(st.Expr.Terms) == 1 && st.Expr.Terms[0].Term.Atom == nil) {
				continue
			}
			cand := clone(cur)
			cand.Steps[i].Expr = &dsl.Expr{Terms: []dsl.SignedTerm{{Term: dsl.Term{Coef: 1}}}}
			if try(cand) {
				progress = true
			}
		}

		// Drop setup lines.
		for i := 0; i < len(cur.Setup); i++ {
			cand := clone(cur)
			cand.Setup = append(append([]dsl.SetupPut(nil), cur.Setup[:i]...), cur.Setup[i+1:]...)
			if try(cand) {
				progress = true
				i--
			}
		}

		// Drop WHERE filters.
		for i := range cur.Steps {
			if cur.Steps[i].Where == nil {
				continue
			}
			cand := clone(cur)
			cand.Steps[i].Where = nil
			if try(cand) {
				progress = true
			}
		}
	}
	return cur
}

func clone(sc *dsl.Scenario) *dsl.Scenario {
	c := *sc
	c.Steps = append([]dsl.Step(nil), sc.Steps...)
	c.Setup = append([]dsl.SetupPut(nil), sc.Setup...)
	c.Invariants = append([]dsl.Invariant(nil), sc.Invariants...)
	return &c
}

func txnIDs(sc *dsl.Scenario) []string {
	seen := map[string]bool{}
	var ids []string
	for _, st := range sc.Steps {
		if !seen[st.Txn] {
			seen[st.Txn] = true
			ids = append(ids, st.Txn)
		}
	}
	return ids
}
