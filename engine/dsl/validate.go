package dsl

// validate enforces the static rules of spec §4.10 and §5.3.
func validate(sc *Scenario, errs *errList) {
	keys := map[string]struct{}{}
	addKey := func(k string) { keys[k] = struct{}{} }

	setupSeen := map[string]bool{}
	for _, p := range sc.Setup {
		if setupSeen[p.Key] {
			errs.add(p.Line, 1, "duplicate setup key '"+p.Key+"'")
		}
		setupSeen[p.Key] = true
		addKey(p.Key)
	}

	if len(sc.Steps) > MaxSteps {
		errs.add(sc.Steps[MaxSteps].Line, 1, "schedule exceeds "+itoa(MaxSteps)+" steps")
	}

	type txnState struct {
		begun, ended bool
		lastLine     int
	}
	txns := map[string]*txnState{}
	order := []string{}
	bound := map[string]string{} // variable -> txn that binds it

	for _, st := range sc.Steps {
		ts := txns[st.Txn]
		if ts == nil {
			ts = &txnState{}
			txns[st.Txn] = ts
			order = append(order, st.Txn)
			if st.Op != "BEGIN" {
				errs.add(st.Line, st.Col, st.Txn+" must start with BEGIN")
			}
		}
		ts.lastLine = st.Line
		if ts.ended {
			errs.add(st.Line, st.Col, st.Txn+" has a step after its COMMIT/ABORT")
			continue
		}
		switch st.Op {
		case "BEGIN":
			if ts.begun {
				errs.add(st.Line, st.Col, st.Txn+" has more than one BEGIN")
			}
			ts.begun = true
		case "COMMIT", "ABORT":
			ts.ended = true
		case "READ", "SCAN":
			if st.Op == "READ" {
				addKey(st.Key)
			}
			bindVar(errs, bound, st, st.As)
		case "PUT":
			addKey(st.Key)
			checkPutVars(errs, bound, st)
		case "DELETE":
			addKey(st.Key)
		}
	}
	for _, id := range order {
		ts := txns[id]
		if !ts.ended {
			errs.add(ts.lastLine, 1, id+" never ends; its last step must be COMMIT or ABORT")
		}
	}
	if len(sc.Steps) == 0 {
		errs.add(1, 1, "schedule is empty")
	}
	if len(keys) > MaxKeys {
		errs.add(1, 1, "scenario uses more than "+itoa(MaxKeys)+" distinct keys")
	}

	for _, inv := range sc.Invariants {
		for _, e := range []Expr{inv.LHS, inv.RHS} {
			for _, st := range e.Terms {
				a := st.Term.Atom
				if a == nil {
					continue
				}
				switch a.Kind {
				case AtomVar, AtomCount, AtomSum:
					if _, ok := bound[a.Name]; !ok {
						errs.add(inv.Line, 1, "invariant uses variable '"+a.Name+"' that no step binds")
					}
				case AtomCommitted:
					if txns[a.Name] == nil {
						errs.add(inv.Line, 1, "invariant refers to "+a.Name+", which is not in the schedule")
					}
				}
			}
		}
	}
}

func bindVar(errs *errList, bound map[string]string, st Step, name string) {
	if prev, dup := bound[name]; dup {
		errs.add(st.Line, st.Col, "variable '"+name+"' is already bound by "+prev+" (variables are single-assignment)")
		return
	}
	bound[name] = st.Txn
}

func checkPutVars(errs *errList, bound map[string]string, st Step) {
	for _, t := range st.Expr.Terms {
		a := t.Term.Atom
		if a == nil {
			continue
		}
		owner, ok := bound[a.Name]
		switch {
		case !ok:
			errs.add(st.Line, st.Col, "variable '"+a.Name+"' is used before it is bound")
		case owner != st.Txn:
			errs.add(st.Line, st.Col, "variable '"+a.Name+"' is bound by "+owner+"; a PUT may only use its own transaction's variables")
		}
	}
}
