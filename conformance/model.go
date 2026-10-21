package conformance

import (
	"fmt"
	"sort"
	"strings"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/oracle"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

// Abort classes. Both the engine's reason codes and PostgreSQL's SQLSTATEs are
// reduced to these so the two sides can be compared.
const (
	ClassSerialization = "serialization" // engine abort_concurrent_update / abort_dependencies, SQLSTATE 40001
	ClassDeadlock      = "deadlock"      // engine abort_deadlock, SQLSTATE 40P01
	ClassRuntime       = "runtime"       // engine abort_runtime_error (never produced by PostgreSQL)
	ClassBlockedAtEnd  = "blocked_at_end"
	ClassUser          = "user"
	ClassUnexpected    = "unexpected" // any other SQLSTATE: a harness or environment problem
)

// ClassOfReason maps an engine reason code to an abort class.
func ClassOfReason(reason string) string {
	switch reason {
	case trace.AbortConcurrentUpdate, trace.AbortDependencies:
		return ClassSerialization
	case trace.AbortDeadlock:
		return ClassDeadlock
	case trace.AbortRuntimeError:
		return ClassRuntime
	case trace.BlockedAtEnd:
		return ClassBlockedAtEnd
	case trace.AbortUser:
		return ClassUser
	case "":
		return ClassUnfinished
	}
	return "reason:" + reason
}

// Step is what happened to one scheduled line.
type Step struct {
	Txn    string            `json:"txn"`
	Op     string            `json:"op"`
	Status string            `json:"status"` // ok | aborted | skipped
	Abort  string            `json:"abort,omitempty"`
	Read   *trace.ReadResult `json:"read,omitempty"`
	Rows   []trace.KV        `json:"rows,omitempty"`
	IsScan bool              `json:"isScan,omitempty"`
	Wrote  *int64            `json:"wrote,omitempty"`
	Detail string            `json:"detail,omitempty"` // reason code or PostgreSQL message, never compared
}

// TxnOutcome is the end state of one transaction.
type TxnOutcome struct {
	Committed bool   `json:"committed"`
	Abort     string `json:"abort,omitempty"`  // class, "user" for a scripted ABORT
	Reason    string `json:"reason,omitempty"` // engine reason code or PostgreSQL message
}

// History is one execution of a schedule, by either the engine or PostgreSQL.
type History struct {
	Steps []Step
	Txns  map[string]TxnOutcome
	Final []trace.KV
	// Anomalies lists things that should not happen (unexpected SQLSTATEs,
	// statements that never returned...). They always count as a mismatch.
	Anomalies []string
	// RaceRisk is set (PostgreSQL side only) when two statements were blocked at
	// the same time. One commit or abort then releases them together and they
	// proceed concurrently, which the engine models as FIFO (docs/METHODOLOGY.md).
	RaceRisk bool

	vars map[string]map[string]dsl.Binding // txn -> bound variables
	ops  map[string][]oracle.Op            // txn -> executed statements (for the oracle)
}

// TxnIDs returns the transaction ids in order.
func (h *History) TxnIDs() []string {
	ids := make([]string, 0, len(h.Txns))
	for id := range h.Txns {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// SystemAborts returns the transactions the system (not the script) aborted,
// id -> class.
func (h *History) SystemAborts() map[string]string {
	out := map[string]string{}
	for id, t := range h.Txns {
		if !t.Committed && t.Abort != ClassUser && t.Abort != ClassUnfinished && t.Abort != "" {
			out[id] = t.Abort
		}
	}
	return out
}

// HasDeadlock reports whether any transaction was aborted as a deadlock victim.
func (h *History) HasDeadlock() bool {
	for _, t := range h.Txns {
		if t.Abort == ClassDeadlock {
			return true
		}
	}
	return false
}

// FromTrace converts an engine trace to a History.
func FromTrace(sc *dsl.Scenario, tr *trace.Trace) *History {
	h := &History{
		Steps: make([]Step, len(sc.Steps)),
		Txns:  map[string]TxnOutcome{},
		Final: tr.FinalState,
		vars:  map[string]map[string]dsl.Binding{},
		ops:   map[string][]oracle.Op{},
	}
	for i, st := range sc.Steps {
		h.Steps[i] = Step{Txn: st.Txn, Op: st.Op}
	}
	// A step that blocked has several events; the last one is what happened.
	for i := range tr.Steps {
		ev := &tr.Steps[i]
		s := &h.Steps[ev.ScheduledIndex]
		switch ev.Status {
		case trace.StOK:
			s.Status = "ok"
			switch r := ev.Result.(type) {
			case trace.ReadResult:
				rr := r
				s.Read = &rr
			case trace.ScanResult:
				s.IsScan = true
				s.Rows = r.Rows
			}
			if ev.Op == "PUT" {
				s.Wrote = ev.Args.Value
			}
		case trace.StAborted:
			if ev.Reason == trace.AbortUser {
				// The engine reports a scripted ABORT as an aborted event; it
				// is the statement succeeding, as ROLLBACK does in PostgreSQL.
				s.Status = "ok"
				continue
			}
			s.Status, s.Abort, s.Detail = "aborted", ClassOfReason(ev.Reason), ev.Reason
		case trace.StSkipped:
			s.Status = "skipped"
		}
	}
	for _, t := range tr.Txns {
		o := TxnOutcome{Committed: t.Status == "committed"}
		if t.AbortReason != nil {
			o.Abort, o.Reason = ClassOfReason(*t.AbortReason), *t.AbortReason
		}
		h.Txns[t.ID] = o
	}
	return h
}

// Diff lists the differences between two histories of the same schedule,
// strictly: per-statement results, final state and the abort set. a is the
// engine, b is PostgreSQL.
func Diff(a, b *History) []string {
	var d []string
	if len(a.Anomalies) > 0 || len(b.Anomalies) > 0 {
		d = append(d, fmt.Sprintf("anomalies: engine=%v postgres=%v", a.Anomalies, b.Anomalies))
	}
	for i := range a.Steps {
		x, y := a.Steps[i], b.Steps[i]
		where := fmt.Sprintf("step %d (%s %s)", i, x.Txn, x.Op)
		if x.Status != y.Status {
			d = append(d, fmt.Sprintf("%s: status engine=%s postgres=%s", where, x.Status, y.Status))
			continue
		}
		if x.Status == "aborted" && x.Abort != y.Abort {
			d = append(d, fmt.Sprintf("%s: abort class engine=%s postgres=%s", where, x.Abort, y.Abort))
		}
		if x.Status != "ok" {
			continue
		}
		switch {
		case x.Read != nil || y.Read != nil:
			if x.Read == nil || y.Read == nil || *x.Read != *y.Read {
				d = append(d, fmt.Sprintf("%s: read engine=%s postgres=%s", where, fmtRead(x.Read), fmtRead(y.Read)))
			}
		case x.IsScan || y.IsScan:
			if fmtRows(x.Rows) != fmtRows(y.Rows) {
				d = append(d, fmt.Sprintf("%s: rows engine=%s postgres=%s", where, fmtRows(x.Rows), fmtRows(y.Rows)))
			}
		case x.Op == "PUT":
			if fmtPtr(x.Wrote) != fmtPtr(y.Wrote) {
				d = append(d, fmt.Sprintf("%s: wrote engine=%s postgres=%s", where, fmtPtr(x.Wrote), fmtPtr(y.Wrote)))
			}
		}
	}
	if fmtRows(a.Final) != fmtRows(b.Final) {
		d = append(d, fmt.Sprintf("final state engine=%s postgres=%s", fmtRows(a.Final), fmtRows(b.Final)))
	}
	if x, y := fmtAborts(a.SystemAborts()), fmtAborts(b.SystemAborts()); x != y {
		d = append(d, fmt.Sprintf("abort set engine=%s postgres=%s", x, y))
	}
	return d
}

func fmtRead(r *trace.ReadResult) string {
	if r == nil {
		return "-"
	}
	if r.Absent {
		return "absent"
	}
	return fmt.Sprint(r.Value)
}

func fmtPtr(p *int64) string {
	if p == nil {
		return "-"
	}
	return fmt.Sprint(*p)
}

func fmtRows(rows []trace.KV) string {
	parts := make([]string, len(rows))
	for i, r := range rows {
		parts[i] = fmt.Sprintf("%s=%d", r.Key, r.Value)
	}
	return "[" + strings.Join(parts, " ") + "]"
}

func fmtAborts(m map[string]string) string {
	ids := make([]string, 0, len(m))
	for id := range m {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = id + ":" + m[id]
	}
	return "{" + strings.Join(parts, " ") + "}"
}

// SerializablePG asks the oracle whether the committed transactions of a
// PostgreSQL history are equivalent to some serial order.
func (h *History) SerializablePG(setup []trace.KV) bool {
	var committed []oracle.Txn
	for _, id := range h.TxnIDs() {
		if h.Txns[id].Committed {
			committed = append(committed, oracle.Txn{ID: id, Ops: h.ops[id]})
		}
	}
	ok, _ := oracle.Check(oracle.Input{Setup: setup, Txns: committed, Final: h.Final})
	return ok
}

// Describe renders a history one line per scheduled step, for investigations.
func Describe(sc *dsl.Scenario, h *History) string {
	var b strings.Builder
	for i, s := range h.Steps {
		res := ""
		switch {
		case s.Status != "ok":
			res = s.Status
			if s.Abort != "" {
				res += "/" + s.Abort
			}
		case s.Read != nil:
			res = "= " + fmtRead(s.Read)
		case s.IsScan:
			res = "= " + fmtRows(s.Rows)
		case s.Wrote != nil:
			res = fmt.Sprintf("wrote %d", *s.Wrote)
		default:
			res = "ok"
		}
		fmt.Fprintf(&b, "%3d %-3s %-8s %-10s %s\n", i, s.Txn, s.Op, stepArg(sc.Steps[i]), res)
	}
	fmt.Fprintf(&b, "    final %s aborts %s\n", fmtRows(h.Final), fmtAborts(h.SystemAborts()))
	if len(h.Anomalies) > 0 {
		fmt.Fprintf(&b, "    anomalies %v\n", h.Anomalies)
	}
	return b.String()
}

func stepArg(st dsl.Step) string {
	switch st.Op {
	case "READ", "PUT", "DELETE", "SCAN":
		return st.Key
	}
	return ""
}
