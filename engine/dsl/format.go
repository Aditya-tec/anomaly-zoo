package dsl

import "strings"

func quote(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for i := 0; i < len(s); i++ {
		if s[i] == '"' || s[i] == '\\' {
			b.WriteByte('\\')
		}
		b.WriteByte(s[i])
	}
	b.WriteByte('"')
	return b.String()
}

func (w *Where) format() string { return w.Cmp + " " + itoa(w.Value) }

func (a *Atom) format() string {
	switch a.Kind {
	case AtomCount:
		return "count(" + a.Name + ")"
	case AtomSum:
		return "sum(" + a.Name + ")"
	case AtomFinalVal:
		return "final.val(" + quote(a.Name) + ")"
	case AtomFinalCount:
		if a.Where != nil {
			return "final.count(" + quote(a.Name) + " WHERE " + a.Where.format() + ")"
		}
		return "final.count(" + quote(a.Name) + ")"
	case AtomFinalSum:
		return "final.sum(" + quote(a.Name) + ")"
	case AtomCommitted:
		return "committed(" + a.Name + ")"
	}
	return a.Name
}

func (t *Term) format() string {
	if t.Atom == nil {
		return itoa(t.Coef)
	}
	if t.HasCoef {
		return itoa(t.Coef) + " * " + t.Atom.format()
	}
	return t.Atom.format()
}

// Format renders the expression canonically.
func (e *Expr) Format() string {
	var b strings.Builder
	for i, st := range e.Terms {
		if i > 0 {
			if st.Neg {
				b.WriteString(" - ")
			} else {
				b.WriteString(" + ")
			}
		}
		b.WriteString(st.Term.format())
	}
	return b.String()
}

// FormatInvariantExpr renders `lhs CMP rhs` (used in trace JSON).
func (inv *Invariant) FormatInvariantExpr() string {
	return inv.LHS.Format() + " " + inv.Cmp + " " + inv.RHS.Format()
}

// Format is the canonical printer: Parse(Format(s)) yields an equal scenario.
func Format(sc *Scenario) string {
	var b strings.Builder
	b.WriteString("scenario " + sc.ID + "\n")
	if sc.Title != "" {
		b.WriteString("title " + quote(sc.Title) + "\n")
	}
	if sc.Story != "" {
		b.WriteString("story " + quote(sc.Story) + "\n")
	}
	for i := range sc.Invariants {
		inv := &sc.Invariants[i]
		b.WriteString("invariant " + quote(inv.Name) + ": " + inv.FormatInvariantExpr() + "\n")
	}
	if len(sc.Setup) > 0 {
		b.WriteString("setup:\n")
		for _, p := range sc.Setup {
			b.WriteString("  PUT " + p.Key + " = " + itoa(p.Value) + "\n")
		}
	}
	b.WriteString("schedule:\n")
	for _, st := range sc.Steps {
		b.WriteString("  " + st.Txn + " " + st.Op)
		switch st.Op {
		case "READ":
			b.WriteString(" " + st.Key + " AS " + st.As)
		case "SCAN":
			b.WriteString(" " + st.Key)
			if st.Where != nil {
				b.WriteString(" WHERE " + st.Where.format())
			}
			b.WriteString(" AS " + st.As)
		case "PUT":
			b.WriteString(" " + st.Key + " = " + st.Expr.Format())
		case "DELETE":
			b.WriteString(" " + st.Key)
		case "NOTE":
			b.WriteString(" " + quote(st.Text))
		}
		b.WriteString("\n")
	}
	return b.String()
}
