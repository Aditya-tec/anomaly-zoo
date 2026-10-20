package dsl

import "errors"

// Binding is what a READ or SCAN stores in a variable.
type Binding struct {
	Value int64 // READ value (0 when absent)
	Count int64 // number of rows (READ: 1 or 0)
	Sum   int64 // sum of row values (READ: the value)
}

// Env supplies the values an expression needs. The final.* and committed
// methods are only called for invariants.
type Env interface {
	Var(name string) (Binding, bool)
	FinalVal(key string) int64
	FinalCount(prefix string, w *Where) int64
	FinalSum(prefix string) int64
	Committed(txn string) bool
}

// ErrRange reports arithmetic leaving ±MaxValue.
var ErrRange = errors.New("arithmetic out of range")

// UnboundError reports a variable that was never bound at run time.
type UnboundError struct{ Name string }

func (u *UnboundError) Error() string { return "variable '" + u.Name + "' is unbound" }

// Compare applies a comparison operator.
func Compare(op string, a, b int64) bool {
	switch op {
	case "==":
		return a == b
	case "!=":
		return a != b
	case "<":
		return a < b
	case "<=":
		return a <= b
	case ">":
		return a > b
	case ">=":
		return a >= b
	}
	return false
}

func checked(v int64) (int64, error) {
	if v > MaxValue || v < -MaxValue {
		return 0, ErrRange
	}
	return v, nil
}

func (a *Atom) eval(env Env) (int64, error) {
	switch a.Kind {
	case AtomVar, AtomCount, AtomSum:
		b, ok := env.Var(a.Name)
		if !ok {
			return 0, &UnboundError{a.Name}
		}
		switch a.Kind {
		case AtomCount:
			return b.Count, nil
		case AtomSum:
			return b.Sum, nil
		}
		return b.Value, nil
	case AtomFinalVal:
		return env.FinalVal(a.Name), nil
	case AtomFinalCount:
		return env.FinalCount(a.Name, a.Where), nil
	case AtomFinalSum:
		return env.FinalSum(a.Name), nil
	case AtomCommitted:
		if env.Committed(a.Name) {
			return 1, nil
		}
		return 0, nil
	}
	return 0, errors.New("unknown atom")
}

func (t *Term) eval(env Env) (int64, error) {
	if t.Atom == nil {
		return t.Coef, nil
	}
	v, err := t.Atom.eval(env)
	if err != nil {
		return 0, err
	}
	if t.HasCoef {
		return checked(t.Coef * v) // |Coef|,|v| <= 1e9 so the product fits int64
	}
	return v, nil
}

// Eval evaluates the expression with checked arithmetic.
func (e *Expr) Eval(env Env) (int64, error) {
	var acc int64
	for _, st := range e.Terms {
		v, err := st.Term.eval(env)
		if err != nil {
			return 0, err
		}
		if st.Neg {
			acc -= v
		} else {
			acc += v
		}
		if acc, err = checked(acc); err != nil {
			return 0, err
		}
	}
	return acc, nil
}

// InvariantStatus is the verdict of one invariant.
type InvariantStatus string

const (
	InvHolds    InvariantStatus = "holds"
	InvViolated InvariantStatus = "violated"
	InvNA       InvariantStatus = "n/a"
)

// InvariantResult is the evaluated invariant.
type InvariantResult struct {
	Name   string
	Status InvariantStatus
	Detail string
}

// EvalInvariant evaluates inv. An unbound variable (or an arithmetic range
// error) yields n/a, never "violated".
func EvalInvariant(inv *Invariant, env Env) InvariantResult {
	res := InvariantResult{Name: inv.Name}
	l, err := inv.LHS.Eval(env)
	if err == nil {
		var r int64
		if r, err = inv.RHS.Eval(env); err == nil {
			res.Detail = "lhs=" + itoa(l) + " rhs=" + itoa(r)
			if Compare(inv.Cmp, l, r) {
				res.Status = InvHolds
			} else {
				res.Status = InvViolated
			}
			return res
		}
	}
	res.Status = InvNA
	if u, ok := err.(*UnboundError); ok {
		res.Detail = "not evaluated: " + u.Error() + " (its transaction never reached that step)"
	} else {
		res.Detail = "not evaluated: " + err.Error()
	}
	return res
}
