// Package oracle decides whether the committed transactions of a run are
// equivalent to some serial order (spec §5.5).
package oracle

import (
	"sort"
	"strings"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

// Op is one executed statement with what the concurrent run observed.
type Op struct {
	Kind  string // READ SCAN PUT DELETE
	Key   string // key, or prefix for SCAN
	Where *dsl.Where
	As    string
	Expr  *dsl.Expr
	// Observed results.
	Value  int64
	Absent bool
	Rows   []trace.KV
}

// Txn is a committed transaction's operations in program order.
type Txn struct {
	ID  string
	Ops []Op
}

// Input is everything the oracle needs.
type Input struct {
	Setup []trace.KV
	Txns  []Txn
	Final []trace.KV // observed final state, sorted by key
}

type state map[string]int64

func (s state) clone() state {
	c := make(state, len(s))
	for k, v := range s {
		c[k] = v
	}
	return c
}

type varEnv map[string]dsl.Binding

func (e varEnv) Var(n string) (dsl.Binding, bool)  { b, ok := e[n]; return b, ok }
func (varEnv) FinalVal(string) int64               { return 0 }
func (varEnv) FinalCount(string, *dsl.Where) int64 { return 0 }
func (varEnv) FinalSum(string) int64               { return 0 }
func (varEnv) Committed(string) bool               { return false }

// replay runs t atomically on st, returning false when any read differs from
// what was observed. st is modified in place.
func replay(st state, t Txn) bool {
	vars := varEnv{}
	for _, op := range t.Ops {
		switch op.Kind {
		case "READ":
			v, ok := st[op.Key]
			if ok == op.Absent || (ok && v != op.Value) {
				return false
			}
			vars[op.As] = dsl.Binding{Value: v, Count: b2i(ok), Sum: v}
		case "SCAN":
			keys := make([]string, 0, len(st))
			for k := range st {
				if strings.HasPrefix(k, op.Key) {
					keys = append(keys, k)
				}
			}
			sort.Strings(keys)
			var rows []trace.KV
			var sum int64
			for _, k := range keys {
				if op.Where == nil || dsl.Compare(op.Where.Cmp, st[k], op.Where.Value) {
					rows = append(rows, trace.KV{Key: k, Value: st[k]})
					sum += st[k]
				}
			}
			if len(rows) != len(op.Rows) {
				return false
			}
			for i := range rows {
				if rows[i] != op.Rows[i] {
					return false
				}
			}
			vars[op.As] = dsl.Binding{Value: int64(len(rows)), Count: int64(len(rows)), Sum: sum}
		case "PUT":
			v, err := op.Expr.Eval(vars)
			if err != nil {
				return false
			}
			st[op.Key] = v
		case "DELETE":
			delete(st, op.Key)
		}
	}
	return true
}

func b2i(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

func equalFinal(st state, final []trace.KV) bool {
	if len(st) != len(final) {
		return false
	}
	for _, kv := range final {
		if v, ok := st[kv.Key]; !ok || v != kv.Value {
			return false
		}
	}
	return true
}

// Check searches serial orders (depth-first, transactions tried in ID order,
// so the witness is deterministic). It returns the first accepting order.
func Check(in Input) (bool, []string) {
	txns := append([]Txn(nil), in.Txns...)
	sort.Slice(txns, func(i, j int) bool { return txns[i].ID < txns[j].ID })
	init := state{}
	for _, kv := range in.Setup {
		init[kv.Key] = kv.Value
	}
	used := make([]bool, len(txns))
	order := make([]string, 0, len(txns))
	var dfs func(st state) bool
	dfs = func(st state) bool {
		if len(order) == len(txns) {
			return equalFinal(st, in.Final)
		}
		for i := range txns {
			if used[i] {
				continue
			}
			next := st.clone()
			if !replay(next, txns[i]) {
				continue
			}
			used[i] = true
			order = append(order, txns[i].ID)
			if dfs(next) {
				return true
			}
			order = order[:len(order)-1]
			used[i] = false
		}
		return false
	}
	if dfs(init) {
		return true, append([]string{}, order...)
	}
	return false, nil
}
