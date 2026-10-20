// Package txn is the transaction manager: snapshots, write locks, blocking,
// deadlock detection, commit and abort (spec Â§4.5-Â§4.9, Â§5.2).
package txn

import (
	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/mvcc"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

type Status int

const (
	Active Status = iota
	Committed
	Aborted
)

// Txn is one transaction's state.
type Txn struct {
	ID          string
	Status      Status
	HasSnapshot bool
	SnapshotTS  uint64
	CommitTS    uint64
	Locks       []string // keys write-locked, in acquisition order
	Vars        map[string]dsl.Binding
	Doomed      string // reason code once doomed by SSI, else ""
	AbortReason string // reason code once aborted
}

type OutcomeStatus int

const (
	OutOK OutcomeStatus = iota
	OutBlocked
	OutAborted
)

// Outcome is the result class of one statement.
type Outcome struct {
	Status    OutcomeStatus
	BlockedOn string
	Reason    string
}

// Result carries everything one statement produced.
type Result struct {
	Out     Outcome
	Reads   []trace.Read
	Effects []trace.Effect
	Value   int64 // READ
	Absent  bool  // READ
	Rows    []trace.KV
	Count   int64
	Sum     int64
}

// Manager owns the store, the clock, locks and the wait-for graph.
type Manager struct {
	Level   trace.Level
	Store   *mvcc.Store
	Clock   uint64
	Txns    map[string]*Txn
	locks   map[string]string
	waitFor map[string]string
	SSI     SSI
}

// New creates a manager and commits the setup data as T0 at commitTS 1.
func New(level trace.Level, setup []dsl.SetupPut) *Manager {
	m := &Manager{
		Level:   level,
		Store:   mvcc.NewStore(),
		Clock:   1,
		Txns:    map[string]*Txn{},
		locks:   map[string]string{},
		waitFor: map[string]string{},
		SSI:     NopSSI{},
	}
	for _, p := range setup {
		m.Store.AppendUncommitted(p.Key, mvcc.Version{Writer: "T0", Value: p.Value})
		m.Store.Stamp(p.Key, "T0", 1)
	}
	return m
}

// Begin registers a transaction. It takes no snapshot yet.
func (m *Manager) Begin(id string) *Txn {
	t := &Txn{ID: id, Vars: map[string]dsl.Binding{}}
	m.Txns[id] = t
	return t
}

// LockHolder returns who holds key's write lock.
func (m *Manager) LockHolder(key string) (string, bool) {
	h, ok := m.locks[key]
	return h, ok
}

// WaitingOn returns the holder t is waiting for, if any.
func (m *Manager) WaitingOn(id string) (string, bool) {
	h, ok := m.waitFor[id]
	return h, ok
}

func (m *Manager) ensureSnapshot(t *Txn) {
	if (m.Level == trace.SI || m.Level == trace.SER) && !t.HasSnapshot {
		t.SnapshotTS = m.Clock
		t.HasSnapshot = true
	}
}

func (m *Manager) reader(t *Txn) mvcc.Reader {
	return mvcc.Reader{ID: t.ID, Level: m.Level, SnapshotTS: t.SnapshotTS}
}

func (m *Manager) abortResult(t *Txn, res Result, reason string) Result {
	res.Effects = append(res.Effects, m.Abort(t, reason)...)
	res.Out = Outcome{Status: OutAborted, Reason: reason}
	return res
}

// Abort rolls t back and releases its locks. Callers handle waking waiters.
func (m *Manager) Abort(t *Txn, reason string) []trace.Effect {
	effects := []trace.Effect{{Kind: trace.EffAbort, Txn: t.ID, Reason: reason}}
	for _, k := range t.Locks {
		m.Store.RemoveUncommitted(k, t.ID)
		delete(m.locks, k)
		effects = append(effects, trace.Effect{Kind: trace.EffLockReleased, Txn: t.ID, Key: k})
	}
	t.Locks = nil
	delete(m.waitFor, t.ID)
	t.Status = Aborted
	t.AbortReason = reason
	m.SSI.OnAbort(m, t)
	return effects
}

func readEntry(key string, v mvcc.Version, ok bool, why string) trace.Read {
	if !ok {
		return trace.Read{Key: key, Why: trace.Absent}
	}
	return trace.Read{Key: key, From: &trace.Ref{Writer: v.Writer, CommitTS: v.CommitTS}, Why: why}
}

func hiddenEntries(key string, chain []mvcc.Version, r mvcc.Reader) []trace.Read {
	var out []trace.Read
	for _, h := range mvcc.HiddenVersions(chain, r) {
		out = append(out, trace.Read{Key: key, From: &trace.Ref{Writer: h.Version.Writer, CommitTS: h.Version.CommitTS}, Why: h.Why})
	}
	return out
}

// Read implements READ.
func (m *Manager) Read(t *Txn, key string) Result {
	var res Result
	if t.Doomed != "" {
		return m.abortResult(t, res, t.Doomed)
	}
	m.ensureSnapshot(t)
	chain := m.Store.Chain(key)
	r := m.reader(t)
	v, ok, why := mvcc.Visible(chain, r, m.Clock)
	res.Reads = append([]trace.Read{readEntry(key, v, ok, why)}, hiddenEntries(key, chain, r)...)
	if ok {
		res.Value = v.Value
	} else {
		res.Absent = true
	}
	return res
}

// Scan implements SCAN.
func (m *Manager) Scan(t *Txn, prefix string, where *dsl.Where) Result {
	var res Result
	if t.Doomed != "" {
		return m.abortResult(t, res, t.Doomed)
	}
	m.ensureSnapshot(t)
	r := m.reader(t)
	res.Rows = []trace.KV{}
	for _, k := range m.Store.KeysWithPrefix(prefix) {
		chain := m.Store.Chain(k)
		v, ok, why := mvcc.Visible(chain, r, m.Clock)
		if ok && (where == nil || dsl.Compare(where.Cmp, v.Value, where.Value)) {
			res.Rows = append(res.Rows, trace.KV{Key: k, Value: v.Value})
			res.Count++
			res.Sum += v.Value
			res.Reads = append(res.Reads, readEntry(k, v, true, why))
		}
		res.Reads = append(res.Reads, hiddenEntries(k, chain, r)...)
	}
	return res
}

// Put implements PUT and DELETE. A blocked statement is retried by calling
// Put again; resumed marks that retry so the trace can say the lock was
// granted after a wait.
func (m *Manager) Put(t *Txn, key string, value int64, deleted, resumed bool) Result {
	var res Result
	if t.Doomed != "" {
		return m.abortResult(t, res, t.Doomed)
	}
	m.ensureSnapshot(t)
	if holder, held := m.locks[key]; held && holder == t.ID {
		m.Store.OverwriteOwn(key, value, deleted)
		res.Effects = append(res.Effects, versionEffect(t.ID, key, value, deleted))
		return res
	} else if held {
		m.waitFor[t.ID] = holder
		if m.cycle(holder, t.ID) {
			return m.abortResult(t, res, trace.AbortDeadlock)
		}
		res.Out = Outcome{Status: OutBlocked, BlockedOn: holder, Reason: trace.BlockedOnLock}
		res.Effects = append(res.Effects, trace.Effect{Kind: trace.EffLockWait, Txn: t.ID, Key: key, Holder: holder})
		return res
	}
	delete(m.waitFor, t.ID)
	m.locks[key] = t.ID
	t.Locks = append(t.Locks, key)
	acq := trace.Effect{Kind: trace.EffLockAcquired, Txn: t.ID, Key: key}
	if resumed {
		acq.Reason = trace.LockGrantedAfterWait
	}
	res.Effects = append(res.Effects, acq)
	m.Store.AppendUncommitted(key, mvcc.Version{Writer: t.ID, Value: value, Deleted: deleted})
	res.Effects = append(res.Effects, versionEffect(t.ID, key, value, deleted))
	return res
}

func versionEffect(txn, key string, v int64, deleted bool) trace.Effect {
	e := trace.Effect{Kind: trace.EffVersionCreate, Txn: txn, Key: key, Deleted: deleted}
	if !deleted {
		e.Value = &v
	}
	return e
}

// cycle reports whether following wait-for edges from start reaches target.
func (m *Manager) cycle(start, target string) bool {
	cur := start
	for i := 0; i <= len(m.Txns)+1; i++ {
		if cur == target {
			return true
		}
		next, ok := m.waitFor[cur]
		if !ok {
			return false
		}
		cur = next
	}
	return false
}

// Commit implements COMMIT.
func (m *Manager) Commit(t *Txn) Result {
	var res Result
	if t.Doomed != "" {
		return m.abortResult(t, res, t.Doomed)
	}
	if m.Level == trace.SER && m.SSI.DangerousAtCommit(m, t) {
		return m.abortResult(t, res, trace.AbortDependencies)
	}
	m.Clock++
	t.CommitTS = m.Clock
	t.Status = Committed
	res.Effects = append(res.Effects, trace.Effect{Kind: trace.EffCommit, Txn: t.ID, CommitTS: t.CommitTS})
	for _, k := range t.Locks {
		m.Store.Stamp(k, t.ID, t.CommitTS)
		delete(m.locks, k)
		res.Effects = append(res.Effects, trace.Effect{Kind: trace.EffLockReleased, Txn: t.ID, Key: k})
	}
	t.Locks = nil
	if m.Level == trace.SER {
		res.Effects = append(res.Effects, m.SSI.AfterCommit(m, t)...)
	}
	return res
}

// UserAbort implements ABORT.
func (m *Manager) UserAbort(t *Txn) Result {
	var res Result
	return m.abortResult(t, res, trace.AbortUser)
}
