// Package gen produces deterministic random schedules for property tests
// (spec §9.3). The PRNG is splitmix64, implemented here so output never
// depends on a Go release.
package gen

import (
	"fmt"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
)

// Rand is a splitmix64 generator.
type Rand struct{ state uint64 }

func New(seed uint64) *Rand { return &Rand{state: seed} }

func (r *Rand) next() uint64 {
	r.state += 0x9e3779b97f4a7c15
	z := r.state
	z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9
	z = (z ^ (z >> 27)) * 0x94d049bb133111eb
	return z ^ (z >> 31)
}

// Intn returns a number in [0, n).
func (r *Rand) Intn(n int) int { return int(r.next() % uint64(n)) }

// Config tunes the generator. Zero values mean the spec defaults: a random
// 2-4 transactions and all five keys.
type Config struct {
	Txns int
	Keys int
}

var allKeys = []string{"p:1", "p:2", "p:3", "q:1", "q:2"}

type binding struct {
	name   string
	isScan bool
}

// Generate builds a valid scenario from seed.
func Generate(seed uint64, cfg Config) *dsl.Scenario {
	r := New(seed)
	nTxns := cfg.Txns
	if nTxns < 2 || nTxns > 6 {
		nTxns = 2 + r.Intn(3)
	}
	keys := allKeys
	if cfg.Keys >= 2 && cfg.Keys < len(allKeys) {
		keys = allKeys[:cfg.Keys]
	}
	prefixes := []string{"p:"}
	for _, k := range keys {
		if k[0] == 'q' {
			prefixes = append(prefixes, "q:")
			break
		}
	}

	sc := &dsl.Scenario{ID: fmt.Sprintf("gen-%d", seed)}

	// Setup: random values for 3 of the keys.
	order := make([]int, len(keys))
	for i := range order {
		order[i] = i
	}
	for i := len(order) - 1; i > 0; i-- {
		j := r.Intn(i + 1)
		order[i], order[j] = order[j], order[i]
	}
	nSetup := 3
	if nSetup > len(keys) {
		nSetup = len(keys)
	}
	chosen := append([]int(nil), order[:nSetup]...)
	for i := 1; i < len(chosen); i++ { // insertion sort so setup is in key order
		for j := i; j > 0 && chosen[j] < chosen[j-1]; j-- {
			chosen[j], chosen[j-1] = chosen[j-1], chosen[j]
		}
	}
	for _, i := range chosen {
		sc.Setup = append(sc.Setup, dsl.SetupPut{Key: keys[i], Value: int64(1 + r.Intn(20))})
	}

	// Per-transaction step lists.
	lists := make([][]dsl.Step, nTxns)
	for ti := 0; ti < nTxns; ti++ {
		id := fmt.Sprintf("T%d", ti+1)
		steps := []dsl.Step{{Txn: id, Op: "BEGIN"}}
		var vars []binding
		nOps := 3 + r.Intn(6)
		for oi := 0; oi < nOps; oi++ {
			name := fmt.Sprintf("v%d_%d", ti+1, oi)
			roll := r.Intn(100)
			switch {
			case roll < 25 || roll >= 90:
				steps = append(steps, dsl.Step{Txn: id, Op: "READ", Key: keys[r.Intn(len(keys))], As: name})
				vars = append(vars, binding{name: name})
			case roll < 40:
				st := dsl.Step{Txn: id, Op: "SCAN", Key: prefixes[r.Intn(len(prefixes))], As: name}
				if r.Intn(2) == 0 {
					ops := []string{"==", "!=", "<", "<=", ">", ">="}
					st.Where = &dsl.Where{Cmp: ops[r.Intn(len(ops))], Value: int64(r.Intn(20))}
				}
				steps = append(steps, st)
				vars = append(vars, binding{name: name, isScan: true})
			case roll < 65 || len(vars) == 0 && roll < 85:
				steps = append(steps, dsl.Step{Txn: id, Op: "PUT", Key: keys[r.Intn(len(keys))],
					Expr: &dsl.Expr{Terms: []dsl.SignedTerm{{Term: dsl.Term{Coef: int64(r.Intn(100))}}}}})
			case roll < 85:
				b := vars[r.Intn(len(vars))]
				atom := &dsl.Atom{Kind: dsl.AtomVar, Name: b.name}
				if b.isScan {
					atom.Kind = dsl.AtomCount
					if r.Intn(2) == 0 {
						atom.Kind = dsl.AtomSum
					}
				}
				e := &dsl.Expr{Terms: []dsl.SignedTerm{{Term: dsl.Term{Atom: atom}}}}
				if n := r.Intn(21); n > 0 {
					e.Terms = append(e.Terms, dsl.SignedTerm{Neg: r.Intn(2) == 0, Term: dsl.Term{Coef: int64(n)}})
				}
				steps = append(steps, dsl.Step{Txn: id, Op: "PUT", Key: keys[r.Intn(len(keys))], Expr: e})
			default:
				steps = append(steps, dsl.Step{Txn: id, Op: "DELETE", Key: keys[r.Intn(len(keys))]})
			}
		}
		end := "COMMIT"
		if r.Intn(100) < 20 {
			end = "ABORT"
		}
		lists[ti] = append(steps, dsl.Step{Txn: id, Op: end})
	}

	// Random interleaving that preserves per-transaction order.
	pos := make([]int, nTxns)
	for {
		var live []int
		for i := range lists {
			if pos[i] < len(lists[i]) {
				live = append(live, i)
			}
		}
		if len(live) == 0 {
			break
		}
		ti := live[r.Intn(len(live))]
		sc.Steps = append(sc.Steps, lists[ti][pos[ti]])
		pos[ti]++
	}

	parsed, errs := dsl.Parse(dsl.Format(sc))
	if len(errs) > 0 {
		panic(fmt.Sprintf("gen produced an invalid scenario (seed %d): %v\n%s", seed, errs, dsl.Format(sc)))
	}
	return parsed
}
