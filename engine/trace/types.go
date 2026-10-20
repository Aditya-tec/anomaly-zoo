// Package trace defines the trace JSON schema (spec §5.8), reason codes and
// canonical encoding. It depends only on the standard library.
package trace

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
)

const (
	SchemaVersion = 1
	EngineVersion = "1.0.0"
)

// Level is an isolation level id.
type Level string

const (
	RU  Level = "RU"
	RC  Level = "RC"
	SI  Level = "SI"
	SER Level = "SER"
)

// Levels lists the levels in display order.
var Levels = []Level{RU, RC, SI, SER}

// Valid reports whether l is one of the four levels.
func (l Level) Valid() bool { return l == RU || l == RC || l == SI || l == SER }

type KV struct {
	Key   string `json:"key"`
	Value int64  `json:"value"`
}

type Ref struct {
	Writer   string `json:"writer"`
	CommitTS uint64 `json:"commitTS"`
}

type Read struct {
	Key  string `json:"key"`
	From *Ref   `json:"from"`
	Why  string `json:"why"`
}

// Effect kinds.
const (
	EffLockAcquired  = "lock_acquired"
	EffLockWait      = "lock_wait"
	EffLockReleased  = "lock_released"
	EffVersionCreate = "version_created"
	EffCommit        = "commit"
	EffAbort         = "abort"
	EffRWEdge        = "rw_edge"
	EffDoomed        = "doomed"
)

type Effect struct {
	Kind     string `json:"kind"`
	Txn      string `json:"txn,omitempty"`
	Key      string `json:"key,omitempty"`
	From     string `json:"from,omitempty"`
	To       string `json:"to,omitempty"`
	Via      string `json:"via,omitempty"`
	Holder   string `json:"holder,omitempty"`
	Reason   string `json:"reason,omitempty"`
	CommitTS uint64 `json:"commitTS,omitempty"`
	Value    *int64 `json:"value,omitempty"`
	Deleted  bool   `json:"deleted,omitempty"`
}

type Where struct {
	Cmp   string `json:"cmp"`
	Value int64  `json:"value"`
}

type Args struct {
	Key    string `json:"key,omitempty"`
	Prefix string `json:"prefix,omitempty"`
	Where  *Where `json:"where,omitempty"`
	As     string `json:"as,omitempty"`
	Expr   string `json:"expr,omitempty"`
	Value  *int64 `json:"value,omitempty"`
	Text   string `json:"text,omitempty"`
}

// ReadResult is the result of a READ.
type ReadResult struct {
	Value  int64 `json:"value"`
	Absent bool  `json:"absent"`
}

// ScanResult is the result of a SCAN.
type ScanResult struct {
	Rows  []KV  `json:"rows"`
	Count int64 `json:"count"`
	Sum   int64 `json:"sum"`
}

type VersionJSON struct {
	Writer   string `json:"writer"`
	Value    int64  `json:"value"`
	Deleted  bool   `json:"deleted"`
	CommitTS uint64 `json:"commitTS"`
}

type KeyVersions struct {
	Key      string        `json:"key"`
	Versions []VersionJSON `json:"versions"`
}

// Event statuses.
const (
	StOK      = "ok"
	StBlocked = "blocked"
	StAborted = "aborted"
	StSkipped = "skipped"
	StQueued  = "queued"
)

type Event struct {
	Index          int           `json:"index"`
	ScheduledIndex int           `json:"scheduledIndex"`
	Resumed        bool          `json:"resumed"`
	Txn            string        `json:"txn"`
	Op             string        `json:"op"`
	Args           Args          `json:"args"`
	Status         string        `json:"status"`
	Reason         string        `json:"reason,omitempty"`
	BlockedOn      string        `json:"blockedOn,omitempty"`
	SnapshotTS     uint64        `json:"snapshotTS"`
	StmtTS         uint64        `json:"stmtTS"`
	Result         any           `json:"result,omitempty"`
	Reads          []Read        `json:"reads"`
	Effects        []Effect      `json:"effects"`
	StoreAfter     []KeyVersions `json:"storeAfter"`
	StoreFull      []KeyVersions `json:"storeFull,omitempty"`
	Note           *string       `json:"note"`
}

type InvDecl struct {
	Name string `json:"name"`
	Expr string `json:"expr"`
}

type ScenarioInfo struct {
	ID         string    `json:"id"`
	Title      string    `json:"title"`
	Story      string    `json:"story"`
	Invariants []InvDecl `json:"invariants"`
}

type TxnSummary struct {
	ID          string  `json:"id"`
	Status      string  `json:"status"`
	SnapshotTS  uint64  `json:"snapshotTS"`
	CommitTS    uint64  `json:"commitTS"`
	AbortReason *string `json:"abortReason"`
}

type InvResult struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

type Serializable struct {
	Verdict      bool     `json:"verdict"`
	WitnessOrder []string `json:"witnessOrder"`
}

type Trace struct {
	SchemaVersion int          `json:"schemaVersion"`
	EngineVersion string       `json:"engineVersion"`
	Scenario      ScenarioInfo `json:"scenario"`
	Level         Level        `json:"level"`
	Setup         []KV         `json:"setup"`
	Steps         []Event      `json:"steps"`
	Txns          []TxnSummary `json:"txns"`
	FinalState    []KV         `json:"finalState"`
	Invariants    []InvResult  `json:"invariants"`
	Serializable  Serializable `json:"serializable"`
	Digest        string       `json:"digest,omitempty"`
}

// encode marshals v and re-encodes it through a generic value so that object
// keys are sorted and there is no insignificant whitespace.
func encode(v any) ([]byte, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var generic any
	if err := dec.Decode(&generic); err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(generic); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// CanonicalJSON returns the canonical JSON (sorted keys, compact) of any value.
func CanonicalJSON(v any) ([]byte, error) { return encode(v) }

// Canonical returns the canonical JSON of t exactly as it stands (including
// its digest field if set).
func Canonical(t *Trace) ([]byte, error) { return encode(t) }

// ComputeDigest returns the hex SHA-256 of the canonical JSON of t without
// its digest field.
func ComputeDigest(t *Trace) (string, error) {
	c := *t
	c.Digest = ""
	b, err := encode(&c)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), nil
}

// Seal sets t.Digest.
func (t *Trace) Seal() error {
	d, err := ComputeDigest(t)
	if err != nil {
		return err
	}
	t.Digest = d
	return nil
}

// Marshal returns the canonical JSON of the sealed trace.
func (t *Trace) Marshal() ([]byte, error) {
	if t.Digest == "" {
		if err := t.Seal(); err != nil {
			return nil, err
		}
	}
	return Canonical(t)
}

// FullSnapshotEvery is the period (in events) of the full-store snapshots
// stored in Event.StoreFull. All other events carry only the keys they changed
// in Event.StoreAfter (an empty version list means the key was removed).
const FullSnapshotEvery = 32

// Replayer rebuilds the store state event by event from a trace.
type Replayer struct {
	chains map[string][]VersionJSON
}

// NewReplayer starts from the trace's setup data (all committed by T0 at 1).
func NewReplayer(t *Trace) *Replayer {
	r := &Replayer{chains: map[string][]VersionJSON{}}
	for _, kv := range t.Setup {
		r.chains[kv.Key] = []VersionJSON{{Writer: "T0", Value: kv.Value, CommitTS: 1}}
	}
	return r
}

// Apply folds in the changes of one event.
func (r *Replayer) Apply(e *Event) {
	for _, kv := range e.StoreAfter {
		if len(kv.Versions) == 0 {
			delete(r.chains, kv.Key)
		} else {
			r.chains[kv.Key] = kv.Versions
		}
	}
}

// Chain returns the current chain of key.
func (r *Replayer) Chain(key string) []VersionJSON { return r.chains[key] }

// Keys returns the keys that currently have a chain.
func (r *Replayer) Keys() []string {
	out := make([]string, 0, len(r.chains))
	for k := range r.chains {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
