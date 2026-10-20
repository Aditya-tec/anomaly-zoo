// Package api is the JSON-in/JSON-out facade over the engine (spec §5.9). The
// WASM glue in cmd/wasm is a thin wrapper around it, so native tests exercise
// exactly the code the browser runs. Every function returns a JSON document and
// never panics: failures are data.
package api

import (
	"encoding/json"
	"fmt"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/run"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

// Version is the engine version string.
func Version() string { return trace.EngineVersion }

type errorsResp struct {
	OK     bool        `json:"ok"`
	Errors []dsl.Error `json:"errors"`
}

type scenarioJSON struct {
	ID         string          `json:"id"`
	Title      string          `json:"title"`
	Story      string          `json:"story"`
	Invariants []trace.InvDecl `json:"invariants"`
	Setup      []trace.KV      `json:"setup"`
	Steps      []stepJSON      `json:"steps"`
	Formatted  string          `json:"formatted"`
}

type stepJSON struct {
	Line  int          `json:"line"`
	Txn   string       `json:"txn"`
	Op    string       `json:"op"`
	Key   string       `json:"key,omitempty"`
	As    string       `json:"as,omitempty"`
	Where *trace.Where `json:"where,omitempty"`
	Expr  string       `json:"expr,omitempty"`
	Text  string       `json:"text,omitempty"`
}

func fail(errs []dsl.Error) string {
	b, _ := json.Marshal(errorsResp{OK: false, Errors: errs})
	return string(b)
}

func failMsg(msg string) string { return fail([]dsl.Error{{Line: 1, Col: 1, Message: msg}}) }

// safely converts a panic into an error response. The engine is not expected
// to panic (it is fuzzed), but a panic must never escape into the browser.
func safely(out *string) {
	if r := recover(); r != nil {
		*out = failMsg(fmt.Sprintf("internal error: %v", r))
	}
}

// ParseJSON parses and validates src.
func ParseJSON(src string) (out string) {
	defer safely(&out)
	sc, errs := dsl.Parse(src)
	if len(errs) > 0 {
		return fail(errs)
	}
	info := scenarioJSON{ID: sc.ID, Title: sc.Title, Story: sc.Story, Invariants: []trace.InvDecl{}, Setup: []trace.KV{}, Steps: []stepJSON{}, Formatted: dsl.Format(sc)}
	for i := range sc.Invariants {
		info.Invariants = append(info.Invariants, trace.InvDecl{Name: sc.Invariants[i].Name, Expr: sc.Invariants[i].FormatInvariantExpr()})
	}
	for _, p := range sc.Setup {
		info.Setup = append(info.Setup, trace.KV{Key: p.Key, Value: p.Value})
	}
	for _, st := range sc.Steps {
		j := stepJSON{Line: st.Line, Txn: st.Txn, Op: st.Op, Key: st.Key, As: st.As, Text: st.Text}
		if st.Where != nil {
			j.Where = &trace.Where{Cmp: st.Where.Cmp, Value: st.Where.Value}
		}
		if st.Expr != nil {
			j.Expr = st.Expr.Format()
		}
		info.Steps = append(info.Steps, j)
	}
	b, err := json.Marshal(struct {
		OK       bool         `json:"ok"`
		Scenario scenarioJSON `json:"scenario"`
	}{true, info})
	if err != nil {
		return failMsg(err.Error())
	}
	return string(b)
}

func traceBytes(sc *dsl.Scenario, lv trace.Level) ([]byte, error) {
	tr, err := run.Run(sc, lv)
	if err != nil {
		return nil, err
	}
	return tr.Marshal()
}

// RunJSON runs src at level and returns {"ok":true,"trace":...}.
func RunJSON(src, level string) (out string) {
	defer safely(&out)
	lv := trace.Level(level)
	if !lv.Valid() {
		return failMsg(fmt.Sprintf("unknown isolation level %q; use RU, RC, SI or SER", level))
	}
	sc, errs := dsl.Parse(src)
	if len(errs) > 0 {
		return fail(errs)
	}
	b, err := traceBytes(sc, lv)
	if err != nil {
		return failMsg(err.Error())
	}
	return `{"ok":true,"trace":` + string(b) + `}`
}

// RunAllJSON runs src at all four levels and returns {"ok":true,"traces":{...}}.
func RunAllJSON(src string) (out string) {
	defer safely(&out)
	sc, errs := dsl.Parse(src)
	if len(errs) > 0 {
		return fail(errs)
	}
	s := `{"ok":true,"traces":{`
	for i, lv := range trace.Levels {
		b, err := traceBytes(sc, lv)
		if err != nil {
			return failMsg(err.Error())
		}
		if i > 0 {
			s += ","
		}
		s += `"` + string(lv) + `":` + string(b)
	}
	return s + "}}"
}
