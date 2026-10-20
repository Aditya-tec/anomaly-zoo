// Package ssi implements the "SSI-lite" tracker of spec §4.8: SIREAD locks
// (read keys and key-prefix scans), rw-antidependency edges, the dangerous
// structure check and the doom logic.
package ssi

import (
	"sort"
	"strings"

	"github.com/Aditya-tec/anomaly-zoo/engine/mvcc"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
	"github.com/Aditya-tec/anomaly-zoo/engine/txn"
)

// Faults are test-only switches used by the mutation checks (AC4.3). Each one
// disables a single rule of §4.8. Never set outside tests.
type Faults struct {
	NoReadEdges   bool // rule 1: edges created by READ
	NoScanEdges   bool // rule 2: edges created by SCAN
	NoWriteEdges  bool // rule 3: edges created by writes against SIREAD locks
	NoCommitCheck bool // dangerous-structure check at COMMIT
	NoAfterCommit bool // re-check of active pivots after a commit
}

// Fault is the active fault set. The zero value is the correct engine.
var Fault Faults

type state struct {
	readKeys map[string]bool
	prefixes map[string]bool
	in, out  map[string]string // peer txn id -> key or prefix that created the edge
}

// Tracker implements txn.SSI.
type Tracker struct {
	st map[string]*state
}

func New() *Tracker { return &Tracker{st: map[string]*state{}} }

var _ txn.SSI = (*Tracker)(nil)

func (tr *Tracker) get(id string) *state {
	s := tr.st[id]
	if s == nil {
		s = &state{
			readKeys: map[string]bool{}, prefixes: map[string]bool{},
			in: map[string]string{}, out: map[string]string{},
		}
		tr.st[id] = s
	}
	return s
}

func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// concurrentWriters returns, sorted, the writers of versions of key that the
// reader cannot see because they are uncommitted or committed after the
// reader's snapshot (the condition of rules 1 and 2).
func concurrentWriters(chain []mvcc.Version, reader *txn.Txn, into map[string]bool) {
	for _, v := range chain {
		if v.Writer != reader.ID && (v.CommitTS == 0 || v.CommitTS > reader.SnapshotTS) {
			into[v.Writer] = true
		}
	}
}

func (tr *Tracker) edgesFromReader(m *txn.Manager, a *txn.Txn, writers map[string]bool, via string) txn.Hook {
	var h txn.Hook
	for _, w := range sortedKeys(writers) {
		b := m.Txns[w]
		if b == nil {
			continue
		}
		eff, abort := tr.addEdge(m, a, b, via, a)
		h.Effects = append(h.Effects, eff...)
		if abort {
			h.AbortSelf = true
			return h
		}
	}
	return h
}

// OnRead records the SIREAD lock on key and creates rule-1 edges.
func (tr *Tracker) OnRead(m *txn.Manager, t *txn.Txn, key string) txn.Hook {
	tr.get(t.ID).readKeys[key] = true
	if Fault.NoReadEdges {
		return txn.Hook{}
	}
	writers := map[string]bool{}
	concurrentWriters(m.Store.Chain(key), t, writers)
	return tr.edgesFromReader(m, t, writers, key)
}

// OnScan records the prefix SIREAD lock and creates rule-2 edges.
func (tr *Tracker) OnScan(m *txn.Manager, t *txn.Txn, prefix string) txn.Hook {
	tr.get(t.ID).prefixes[prefix] = true
	if Fault.NoScanEdges {
		return txn.Hook{}
	}
	writers := map[string]bool{}
	for _, k := range m.Store.KeysWithPrefix(prefix) {
		concurrentWriters(m.Store.Chain(k), t, writers)
	}
	return tr.edgesFromReader(m, t, writers, prefix)
}

// covering returns what lock of a's covers key, or "" when none does. A key
// lock is preferred over a prefix lock; among prefixes the first sorted wins.
func (s *state) covering(key string) string {
	if s.readKeys[key] {
		return key
	}
	for _, p := range sortedKeys(s.prefixes) {
		if strings.HasPrefix(key, p) {
			return p
		}
	}
	return ""
}

// OnWrite creates rule-3 edges from concurrent readers of key to the writer.
func (tr *Tracker) OnWrite(m *txn.Manager, t *txn.Txn, key string) txn.Hook {
	var h txn.Hook
	if Fault.NoWriteEdges {
		return h
	}
	ids := make([]string, 0, len(m.Txns))
	for id := range m.Txns {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		a := m.Txns[id]
		if a == t || a.Status == txn.Aborted {
			continue
		}
		s := tr.st[id]
		if s == nil {
			continue
		}
		via := s.covering(key)
		if via == "" {
			continue
		}
		if a.Status != txn.Active && a.CommitTS <= t.SnapshotTS {
			continue // A committed before the writer's snapshot: not concurrent
		}
		eff, abort := tr.addEdge(m, a, t, via, t)
		h.Effects = append(h.Effects, eff...)
		if abort {
			h.AbortSelf = true
			return h
		}
	}
	return h
}

// addEdge records from -> to and checks both endpoints as pivots. cur is the
// transaction executing the current step.
func (tr *Tracker) addEdge(m *txn.Manager, from, to *txn.Txn, via string, cur *txn.Txn) ([]trace.Effect, bool) {
	if from.Status == txn.Aborted || to.Status == txn.Aborted || from == to {
		return nil, false
	}
	fs := tr.get(from.ID)
	if _, exists := fs.out[to.ID]; exists {
		return nil, false
	}
	fs.out[to.ID] = via
	tr.get(to.ID).in[from.ID] = via
	effects := []trace.Effect{{Kind: trace.EffRWEdge, From: from.ID, To: to.ID, Via: via, Reason: trace.RWEdgeAdded}}
	for _, p := range []*txn.Txn{from, to} {
		eff, abort := tr.resolve(m, p, cur)
		effects = append(effects, eff...)
		if abort {
			return effects, true
		}
	}
	return effects, false
}

// dangerous looks for a dangerous structure with p as the pivot (spec §4.8):
// an in-edge from I, an out-edge to a committed O, where O committed before
// every member of {I, P} other than O (uncommitted counts as later).
func (tr *Tracker) dangerous(m *txn.Manager, p *txn.Txn) (i, o *txn.Txn, found bool) {
	s := tr.st[p.ID]
	if s == nil {
		return nil, nil, false
	}
	for _, iid := range sortedKeys(s.in) {
		for _, oid := range sortedKeys(s.out) {
			ot, it := m.Txns[oid], m.Txns[iid]
			if ot == nil || it == nil || ot.Status != txn.Committed {
				continue
			}
			ok := true
			for _, x := range []*txn.Txn{it, p} {
				if x != ot && x.Status == txn.Committed && x.CommitTS < ot.CommitTS {
					ok = false
				}
			}
			if ok {
				return it, ot, true
			}
		}
	}
	return nil, nil, false
}

// resolve applies the victim rule when p is a dangerous pivot: the pivot if it
// is active, otherwise I if active. The executing transaction aborts now;
// anyone else is doomed.
func (tr *Tracker) resolve(m *txn.Manager, p, cur *txn.Txn) ([]trace.Effect, bool) {
	i, _, found := tr.dangerous(m, p)
	if !found {
		return nil, false
	}
	var victim *txn.Txn
	switch {
	case p.Status == txn.Active:
		victim = p
	case i.Status == txn.Active:
		victim = i
	default:
		return nil, false
	}
	if victim == cur {
		return nil, true
	}
	return tr.doom(victim), false
}

func (tr *Tracker) doom(v *txn.Txn) []trace.Effect {
	if v.Doomed != "" {
		return nil
	}
	v.Doomed = trace.AbortDependencies
	return []trace.Effect{{Kind: trace.EffDoomed, Txn: v.ID, Reason: trace.AbortDependencies}}
}

// DangerousAtCommit reports whether committing t would complete a dangerous
// structure with t as pivot.
func (tr *Tracker) DangerousAtCommit(m *txn.Manager, t *txn.Txn) bool {
	if Fault.NoCommitCheck {
		return false
	}
	_, _, found := tr.dangerous(m, t)
	return found
}

// AfterCommit re-checks every active transaction that has an out-edge to c.
func (tr *Tracker) AfterCommit(m *txn.Manager, c *txn.Txn) []trace.Effect {
	if Fault.NoAfterCommit {
		return nil
	}
	var effects []trace.Effect
	ids := make([]string, 0, len(m.Txns))
	for id := range m.Txns {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		p := m.Txns[id]
		s := tr.st[id]
		if p.Status != txn.Active || s == nil {
			continue
		}
		if _, ok := s.out[c.ID]; !ok {
			continue
		}
		if _, _, found := tr.dangerous(m, p); found {
			effects = append(effects, tr.doom(p)...)
		}
	}
	return effects
}

// OnAbort discards t's SIREAD locks and every edge touching it.
func (tr *Tracker) OnAbort(m *txn.Manager, t *txn.Txn) {
	s := tr.st[t.ID]
	if s == nil {
		return
	}
	for peer := range s.in {
		if ps := tr.st[peer]; ps != nil {
			delete(ps.out, t.ID)
		}
	}
	for peer := range s.out {
		if ps := tr.st[peer]; ps != nil {
			delete(ps.in, t.ID)
		}
	}
	delete(tr.st, t.ID)
}
