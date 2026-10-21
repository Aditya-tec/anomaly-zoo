package conformance

import (
	"context"
	"errors"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/oracle"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Timing holds the harness constants of spec §9.4.
type Timing struct {
	BlockedAfter time.Duration // a statement still running after this and waiting on a lock is "blocked"
	UnblockWait  time.Duration // after a commit/abort, wait this long for newly unblocked statements
	StableLock   time.Duration // a blocked statement must keep waiting this long after the last release to count as still blocked
	Poll         time.Duration
	StmtCap      time.Duration // a statement that is neither done nor lock-waiting after this is an anomaly
}

// DefaultTiming is the specified timing.
var DefaultTiming = Timing{
	BlockedAfter: 200 * time.Millisecond,
	UnblockWait:  2 * time.Second,
	StableLock:   60 * time.Millisecond,
	Poll:         5 * time.Millisecond,
	StmtCap:      10 * time.Second,
}

const (
	sqlRead   = `SELECT v FROM kv WHERE k = $1`
	sqlUpsert = `INSERT INTO kv(k,v) VALUES($1,$2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`
	sqlDelete = `DELETE FROM kv WHERE k = $1`
	// k is declared COLLATE "C" so ORDER BY is byte order whatever the cluster's
	// locale is (DECISIONS.md D-P8-1).
	sqlCreate = `CREATE TABLE IF NOT EXISTS kv(k text COLLATE "C" PRIMARY KEY, v bigint NOT NULL)`
)

var schemaRe = regexp.MustCompile(`^[a-z][a-z0-9_]{0,30}$`)

// Runner executes schedules against one PostgreSQL schema. A Runner is not safe
// for concurrent use; run several Runners (one schema each) for parallelism.
type Runner struct {
	cfg    *pgx.ConnConfig
	admin  *pgx.Conn
	Timing Timing
	// Pad, when > 0, inserts that many filler rows into every gap between the
	// keys a schedule uses, so those keys sit on different index pages. Only the
	// page-granularity control experiment uses it; fillers are left out of the
	// final state.
	Pad int
}

// ServerVersion returns the server_version string (for example "16.15").
func ServerVersion(ctx context.Context, dsn string) (string, error) {
	c, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return "", err
	}
	defer c.Close(ctx)
	var v string
	err = c.QueryRow(ctx, `SHOW server_version`).Scan(&v)
	return v, err
}

// NewRunner connects and prepares table kv in the given schema.
func NewRunner(ctx context.Context, dsn, schema string) (*Runner, error) {
	if !schemaRe.MatchString(schema) {
		return nil, fmt.Errorf("bad schema name %q", schema)
	}
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	cfg.DefaultQueryExecMode = pgx.QueryExecModeExec
	setup, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if _, err := setup.Exec(ctx, `CREATE SCHEMA IF NOT EXISTS `+schema); err != nil {
		setup.Close(ctx)
		return nil, err
	}
	setup.Close(ctx)
	cfg = cfg.Copy()
	cfg.RuntimeParams["search_path"] = schema
	admin, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if _, err := admin.Exec(ctx, sqlCreate); err != nil {
		admin.Close(ctx)
		return nil, err
	}
	// Background vacuum and analyze change page contents and planner statistics
	// while a schedule runs, which can change predicate-lock granularity; they
	// are not part of what is compared (DECISIONS.md D-P8-15).
	stmt := `ALTER TABLE kv SET (autovacuum_enabled = false)`
	if os.Getenv("AZOO_AUTOVACUUM") != "" { // measurement switch only
		stmt = `ALTER TABLE kv RESET (autovacuum_enabled)`
	}
	if _, err := admin.Exec(ctx, stmt); err != nil {
		admin.Close(ctx)
		return nil, err
	}
	return &Runner{cfg: cfg, admin: admin, Timing: DefaultTiming}, nil
}

// Close releases the admin connection.
func (r *Runner) Close(ctx context.Context) { r.admin.Close(ctx) }

var isolation = map[trace.Level]string{
	trace.RC:  "READ COMMITTED",
	trace.SI:  "REPEATABLE READ",
	trace.SER: "SERIALIZABLE",
}

var sqlCmp = map[string]string{"==": "=", "!=": "<>", "<": "<", "<=": "<=", ">": ">", ">=": ">="}

type stmtResult struct {
	read *trace.ReadResult
	rows []trace.KV
	scan bool
	err  error
}

type pendingStmt struct {
	sched int
	step  dsl.Step
	val   int64
	ch    chan stmtResult
}

type queuedStep struct {
	sched int
	step  dsl.Step
}

type txnState struct {
	id        string
	conn      *pgx.Conn
	pid       int32
	began     bool
	committed bool
	aborted   bool
	cancelled bool
	pending   *pendingStmt
	queue     []queuedStep
	vars      map[string]dsl.Binding
	ops       []oracle.Op
	lockSeen  time.Time
}

type orch struct {
	r         *Runner
	ctx       context.Context
	level     trace.Level
	iso       string
	h         *History
	txns      map[string]*txnState
	blocked   []*txnState // FIFO block order
	lastRel   time.Time
	releaseNo int
	settledNo int
}

type txnEnv struct{ vars map[string]dsl.Binding }

func (e txnEnv) Var(n string) (dsl.Binding, bool)  { b, ok := e.vars[n]; return b, ok }
func (txnEnv) FinalVal(string) int64               { return 0 }
func (txnEnv) FinalCount(string, *dsl.Where) int64 { return 0 }
func (txnEnv) FinalSum(string) int64               { return 0 }
func (txnEnv) Committed(string) bool               { return false }

// Run executes sc at level against PostgreSQL and returns what happened.
func (r *Runner) Run(ctx context.Context, sc *dsl.Scenario, level trace.Level) (*History, error) {
	iso, ok := isolation[level]
	if !ok {
		return nil, fmt.Errorf("level %s is not run against PostgreSQL", level)
	}
	return r.RunIsolation(ctx, sc, level, iso)
}

// RunIsolation is Run with an explicit SQL isolation level name (used by the
// READ UNCOMMITTED probe); level only labels the run.
func (r *Runner) RunIsolation(ctx context.Context, sc *dsl.Scenario, level trace.Level, iso string) (*History, error) {
	if _, err := r.admin.Exec(ctx, `TRUNCATE kv`); err != nil {
		return nil, err
	}
	for _, p := range sc.Setup {
		if _, err := r.admin.Exec(ctx, sqlUpsert, p.Key, p.Value); err != nil {
			return nil, err
		}
	}
	if r.Pad > 0 {
		if err := r.pad(ctx, sc); err != nil {
			return nil, err
		}
	}
	h := &History{
		Steps: make([]Step, len(sc.Steps)),
		Txns:  map[string]TxnOutcome{},
		vars:  map[string]map[string]dsl.Binding{},
		ops:   map[string][]oracle.Op{},
	}
	for i, st := range sc.Steps {
		h.Steps[i] = Step{Txn: st.Txn, Op: st.Op}
	}
	o := &orch{r: r, ctx: ctx, level: level, iso: iso, h: h, txns: map[string]*txnState{}}
	var ids []string
	for _, st := range sc.Steps {
		if _, dup := o.txns[st.Txn]; !dup {
			o.txns[st.Txn] = nil
			ids = append(ids, st.Txn)
		}
	}
	sort.Strings(ids)
	defer func() {
		for _, t := range o.txns {
			if t != nil && t.conn != nil {
				t.conn.Close(context.Background())
			}
		}
	}()
	for _, id := range ids {
		c, err := pgx.ConnectConfig(ctx, r.cfg)
		if err != nil {
			return nil, err
		}
		t := &txnState{id: id, conn: c, vars: map[string]dsl.Binding{}}
		o.txns[id] = t
		if _, err := c.Exec(ctx, `SET deadlock_timeout='100ms'`); err != nil {
			return nil, err
		}
		if err := c.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&t.pid); err != nil {
			return nil, err
		}
	}

	for i, st := range sc.Steps {
		t := o.txns[st.Txn]
		switch {
		case t.aborted:
			h.Steps[i].Status = "skipped"
		case t.pending != nil:
			t.queue = append(t.queue, queuedStep{i, st})
		default:
			o.exec(t, i, st)
		}
		for o.settledNo != o.releaseNo {
			o.settledNo = o.releaseNo
			o.settle()
		}
	}
	o.finish()

	rows, err := r.admin.Query(ctx, `SELECT k, v FROM kv ORDER BY k`)
	if err != nil {
		return nil, err
	}
	final := []trace.KV{}
	for rows.Next() {
		var kv trace.KV
		if err := rows.Scan(&kv.Key, &kv.Value); err != nil {
			rows.Close()
			return nil, err
		}
		if r.Pad > 0 && strings.Contains(kv.Key, padMark) {
			continue
		}
		final = append(final, kv)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	h.Final = final
	for _, id := range ids {
		t := o.txns[id]
		out := TxnOutcome{Committed: t.committed}
		if !t.committed {
			out.Abort = ClassUnfinished
			if t.aborted {
				out.Abort, out.Reason = h.Txns[id].Abort, h.Txns[id].Reason
			}
		}
		h.Txns[id] = out
		h.vars[id] = t.vars
		h.ops[id] = t.ops
	}
	return h, nil
}

// ClassUnfinished marks a transaction whose script never reached COMMIT/ABORT.
const ClassUnfinished = "unfinished"

func (o *orch) anomaly(format string, a ...any) {
	o.h.Anomalies = append(o.h.Anomalies, fmt.Sprintf(format, a...))
}

func (o *orch) exec(t *txnState, i int, st dsl.Step) {
	switch st.Op {
	case "BEGIN":
		_, err := t.conn.Exec(o.ctx, `BEGIN ISOLATION LEVEL `+o.iso)
		if err == nil {
			_, err = t.conn.Exec(o.ctx, `SET LOCAL lock_timeout='5s'`)
		}
		if err != nil {
			o.anomaly("%s BEGIN failed: %v", t.id, err)
		}
		t.began = true
		o.h.Steps[i].Status = "ok"
		return
	case "NOTE":
		o.h.Steps[i].Status = "ok"
		return
	}
	var val int64
	if st.Op == "PUT" {
		v, err := st.Expr.Eval(txnEnv{t.vars})
		if err != nil {
			o.abort(t, i, ClassRuntime, "expression out of range", false)
			return
		}
		val = v
	}
	p := &pendingStmt{sched: i, step: st, val: val, ch: make(chan stmtResult, 1)}
	go func() { p.ch <- o.run(t, st, val) }()
	o.awaitOrBlock(t, p)
}

func (o *orch) run(t *txnState, st dsl.Step, val int64) stmtResult {
	ctx := context.Background()
	switch st.Op {
	case "READ":
		rows, err := t.conn.Query(ctx, sqlRead, st.Key)
		if err != nil {
			return stmtResult{err: err}
		}
		res := trace.ReadResult{Absent: true}
		for rows.Next() {
			var v int64
			if err := rows.Scan(&v); err != nil {
				rows.Close()
				return stmtResult{err: err}
			}
			res = trace.ReadResult{Value: v}
		}
		if err := rows.Err(); err != nil {
			return stmtResult{err: err}
		}
		return stmtResult{read: &res}
	case "SCAN":
		q, args := `SELECT k, v FROM kv WHERE starts_with(k, $1) ORDER BY k`, []any{st.Key}
		if st.Where != nil {
			q = `SELECT k, v FROM kv WHERE starts_with(k, $1) AND v ` + sqlCmp[st.Where.Cmp] + ` $2 ORDER BY k`
			args = append(args, st.Where.Value)
		}
		rows, err := t.conn.Query(ctx, q, args...)
		if err != nil {
			return stmtResult{err: err}
		}
		out := []trace.KV{}
		for rows.Next() {
			var kv trace.KV
			if err := rows.Scan(&kv.Key, &kv.Value); err != nil {
				rows.Close()
				return stmtResult{err: err}
			}
			out = append(out, kv)
		}
		if err := rows.Err(); err != nil {
			return stmtResult{err: err}
		}
		return stmtResult{rows: out, scan: true}
	case "PUT":
		_, err := t.conn.Exec(ctx, sqlUpsert, st.Key, val)
		return stmtResult{err: err}
	case "DELETE":
		_, err := t.conn.Exec(ctx, sqlDelete, st.Key)
		return stmtResult{err: err}
	case "COMMIT":
		_, err := t.conn.Exec(ctx, `COMMIT`)
		return stmtResult{err: err}
	case "ABORT":
		_, err := t.conn.Exec(ctx, `ROLLBACK`)
		return stmtResult{err: err}
	}
	return stmtResult{err: fmt.Errorf("unknown op %s", st.Op)}
}

func (o *orch) lockWaiting(pid int32) bool {
	var typ *string
	err := o.r.admin.QueryRow(o.ctx, `SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, pid).Scan(&typ)
	return err == nil && typ != nil && *typ == "Lock"
}

// awaitOrBlock gives the statement BlockedAfter to return; if it has not and
// its backend is waiting on a lock, it is marked blocked and the schedule goes on.
func (o *orch) awaitOrBlock(t *txnState, p *pendingStmt) {
	tm := o.r.Timing
	select {
	case res := <-p.ch:
		o.complete(t, p, res)
		return
	case <-time.After(tm.BlockedAfter):
	}
	start := time.Now()
	for {
		if o.lockWaiting(t.pid) {
			// Re-check: the statement may have finished between the two looks.
			select {
			case res := <-p.ch:
				o.complete(t, p, res)
				return
			default:
			}
			if len(o.blocked) > 0 {
				o.h.RaceRisk = true
			}
			t.pending = p
			t.lockSeen = time.Time{}
			o.blocked = append(o.blocked, t)
			return
		}
		select {
		case res := <-p.ch:
			o.complete(t, p, res)
			return
		case <-time.After(tm.Poll):
		}
		if time.Since(start) > tm.StmtCap {
			o.anomaly("%s %s (step %d) neither returned nor waited on a lock for %v", t.id, p.step.Op, p.sched, tm.StmtCap)
			// Cancel it and treat it as a failure.
			o.cancel(t)
			res := <-p.ch
			o.complete(t, p, res)
			return
		}
	}
}

func (o *orch) cancel(t *txnState) {
	t.cancelled = true
	o.r.admin.Exec(o.ctx, `SELECT pg_cancel_backend($1)`, t.pid)
}

// complete records the outcome of a statement that has returned.
func (o *orch) complete(t *txnState, p *pendingStmt, res stmtResult) {
	s := &o.h.Steps[p.sched]
	if res.err != nil {
		o.fail(t, p.sched, res.err)
		return
	}
	s.Status = "ok"
	switch p.step.Op {
	case "READ":
		s.Read = res.read
		v := res.read.Value
		t.vars[p.step.As] = dsl.Binding{Value: v, Count: 1 - b2i(res.read.Absent), Sum: v}
		t.ops = append(t.ops, oracle.Op{Kind: "READ", Key: p.step.Key, As: p.step.As, Value: v, Absent: res.read.Absent})
	case "SCAN":
		s.IsScan, s.Rows = true, res.rows
		var sum int64
		for _, kv := range res.rows {
			sum += kv.Value
		}
		n := int64(len(res.rows))
		t.vars[p.step.As] = dsl.Binding{Value: n, Count: n, Sum: sum}
		t.ops = append(t.ops, oracle.Op{Kind: "SCAN", Key: p.step.Key, Where: p.step.Where, As: p.step.As, Rows: res.rows})
	case "PUT":
		v := p.val
		s.Wrote = &v
		t.ops = append(t.ops, oracle.Op{Kind: "PUT", Key: p.step.Key, Expr: p.step.Expr})
	case "DELETE":
		t.ops = append(t.ops, oracle.Op{Kind: "DELETE", Key: p.step.Key})
	case "COMMIT":
		t.committed = true
		o.release()
	case "ABORT":
		t.aborted = true
		o.h.Txns[t.id] = TxnOutcome{Abort: ClassUser}
		o.release()
	}
}

func b2i(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// fail handles a statement that returned an error: classify, roll back, mark
// the transaction aborted and skip its remaining steps.
func (o *orch) fail(t *txnState, sched int, err error) {
	class, msg := ClassUnexpected, err.Error()
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		msg = pe.Code + " " + pe.Message
		if pe.Detail != "" {
			msg += " | " + pe.Detail
		}
		switch {
		case pe.Code == "40001":
			class = ClassSerialization
		case pe.Code == "40P01":
			class = ClassDeadlock
		case pe.Code == "57014" && t.cancelled:
			class = ClassBlockedAtEnd
		}
	}
	if class == ClassUnexpected {
		o.anomaly("%s step %d: unexpected error: %s", t.id, sched, msg)
	}
	o.abort(t, sched, class, msg, true)
}

func (o *orch) abort(t *txnState, sched int, class, msg string, rollback bool) {
	s := &o.h.Steps[sched]
	s.Status, s.Abort, s.Detail = "aborted", class, msg
	if rollback || t.began {
		// After an error the transaction is already aborted on the server; the
		// ROLLBACK ends it (and releases its locks).
		t.conn.Exec(context.Background(), `ROLLBACK`)
	}
	t.aborted = true
	o.h.Txns[t.id] = TxnOutcome{Abort: class, Reason: msg}
	q := t.queue
	t.queue = nil
	for _, e := range q {
		o.h.Steps[e.sched].Status = "skipped"
	}
	o.release()
}

func (o *orch) release() {
	o.lastRel = time.Now()
	o.releaseNo++
	for _, b := range o.blocked {
		b.lockSeen = time.Time{}
	}
}

func (o *orch) removeBlocked(t *txnState) {
	for i, b := range o.blocked {
		if b == t {
			o.blocked = append(o.blocked[:i], o.blocked[i+1:]...)
			return
		}
	}
}

// drain runs the steps queued behind a statement that has just completed.
func (o *orch) drain(t *txnState) {
	for len(t.queue) > 0 && !t.aborted && t.pending == nil {
		e := t.queue[0]
		t.queue = t.queue[1:]
		o.exec(t, e.sched, e.step)
	}
}

// settle waits for statements that a commit/abort has unblocked. It returns
// when nothing is blocked, when every blocked statement has kept waiting on a
// lock for StableLock since the last release, or UnblockWait after the last release.
func (o *orch) settle() {
	tm := o.r.Timing
	seen := -1
	var deadline time.Time
	for len(o.blocked) > 0 {
		if seen != o.releaseNo {
			seen = o.releaseNo
			deadline = time.Now().Add(tm.UnblockWait)
		}
		progressed := false
		for _, t := range append([]*txnState(nil), o.blocked...) {
			select {
			case res := <-t.pending.ch:
				p := t.pending
				t.pending = nil
				o.removeBlocked(t)
				o.complete(t, p, res)
				o.drain(t)
				progressed = true
			default:
			}
			if progressed {
				break
			}
		}
		if progressed {
			continue
		}
		now := time.Now()
		stable := true
		for _, t := range o.blocked {
			if o.lockWaiting(t.pid) {
				if t.lockSeen.IsZero() {
					t.lockSeen = now
				}
			} else {
				t.lockSeen = time.Time{}
			}
			if t.lockSeen.IsZero() || now.Sub(t.lockSeen) < tm.StableLock || now.Sub(o.lastRel) < tm.StableLock {
				stable = false
			}
		}
		if stable || now.After(deadline) {
			return
		}
		time.Sleep(tm.Poll)
	}
}

// finish ends the schedule: anything still blocked is cancelled (the engine's
// blocked_at_end), then open transactions are rolled back.
func (o *orch) finish() {
	// Statements completing after the last step are settled here; the release
	// bookkeeping makes settle wait the full window once.
	o.release()
	o.settle()
	for len(o.blocked) > 0 {
		t := o.blocked[0]
		o.cancel(t)
		select {
		case res := <-t.pending.ch:
			p := t.pending
			t.pending = nil
			o.removeBlocked(t)
			o.complete(t, p, res)
		case <-time.After(5 * time.Second):
			o.anomaly("%s did not return after cancel", t.id)
			t.pending = nil
			o.removeBlocked(t)
		}
		o.settle()
	}
	for _, id := range sortedIDs(o.txns) {
		t := o.txns[id]
		if t.began && !t.committed && !t.aborted {
			t.conn.Exec(context.Background(), `ROLLBACK`)
		}
	}
}

func sortedIDs(m map[string]*txnState) []string {
	ids := make([]string, 0, len(m))
	for id := range m {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// padMark is in every filler key; it sorts after every character a scenario key may contain.
const padMark = "~"

// pad inserts r.Pad filler rows after each key the schedule touches, skipping
// any gap whose fillers would match a scanned prefix (they would change scan
// results).
func (r *Runner) pad(ctx context.Context, sc *dsl.Scenario) error {
	keys := map[string]bool{}
	var prefixes []string
	for _, p := range sc.Setup {
		keys[p.Key] = true
	}
	for _, st := range sc.Steps {
		switch st.Op {
		case "READ", "PUT", "DELETE":
			keys[st.Key] = true
		case "SCAN":
			prefixes = append(prefixes, st.Key)
		}
	}
	for k := range keys {
		filler := k + padMark
		skip := false
		for _, p := range prefixes {
			if strings.HasPrefix(filler, p) {
				skip = true
			}
		}
		if skip {
			continue
		}
		if _, err := r.admin.Exec(ctx, `INSERT INTO kv(k, v) SELECT $1 || lpad(g::text, 6, '0'), 0 FROM generate_series(1, $2) g`, filler, r.Pad); err != nil {
			return err
		}
	}
	return nil
}
