// Package matrix computes the anomaly x isolation-level matrix by running the
// engine, and diffs it against scenarios/expected.json (spec §6.2, §9.2).
package matrix

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/run"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

// Cell is one (scenario, level) result.
type Cell struct {
	Invariant    string            `json:"invariant"`
	Serializable bool              `json:"serializable"`
	Aborts       map[string]string `json:"aborts"`
	Mechanism    string            `json:"mechanism"`
}

// Matrix is the full result, same shape as expected.json.
type Matrix struct {
	SchemaVersion int                        `json:"schemaVersion"`
	Cells         map[string]map[string]Cell `json:"cells"`
}

// CellOf summarises a trace.
func CellOf(t *trace.Trace) Cell {
	c := Cell{Invariant: "n/a", Serializable: t.Serializable.Verdict, Aborts: map[string]string{}, Mechanism: "none"}
	holds, violated := 0, 0
	for _, inv := range t.Invariants {
		switch inv.Status {
		case "holds":
			holds++
		case "violated":
			violated++
		}
	}
	switch {
	case violated > 0:
		c.Invariant = "violated"
	case holds > 0:
		c.Invariant = "holds"
	}
	for _, x := range t.Txns {
		if x.AbortReason != nil && *x.AbortReason != trace.AbortUser {
			c.Aborts[x.ID] = *x.AbortReason
		}
	}
	ids := make([]string, 0, len(c.Aborts))
	for id := range c.Aborts {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	switch {
	case len(ids) > 0:
		c.Mechanism = c.Aborts[ids[0]]
	case c.Invariant == "holds":
		c.Mechanism = "visibility"
	}
	return c
}

// Scenarios parses every *.azs in dir, sorted by file name.
func Scenarios(dir string) ([]*dsl.Scenario, error) {
	files, err := filepath.Glob(filepath.Join(dir, "*.azs"))
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	var out []*dsl.Scenario
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			return nil, err
		}
		sc, errs := dsl.Parse(string(b))
		if len(errs) > 0 {
			return nil, fmt.Errorf("%s: %v", f, errs)
		}
		out = append(out, sc)
	}
	return out, nil
}

// Compute runs every scenario in dir at the given levels.
func Compute(dir string, levels []trace.Level) (*Matrix, error) {
	scs, err := Scenarios(dir)
	if err != nil {
		return nil, err
	}
	m := &Matrix{SchemaVersion: 1, Cells: map[string]map[string]Cell{}}
	for _, sc := range scs {
		m.Cells[sc.ID] = map[string]Cell{}
		for _, lv := range levels {
			t, err := run.Run(sc, lv)
			if err != nil {
				return nil, err
			}
			m.Cells[sc.ID][string(lv)] = CellOf(t)
		}
	}
	return m, nil
}

// Load reads an expected.json file.
func Load(path string) (*Matrix, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var m Matrix
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// Diff lists every difference between got and want restricted to levels.
func Diff(got, want *Matrix, levels []trace.Level) []string {
	var out []string
	ids := map[string]bool{}
	for id := range want.Cells {
		ids[id] = true
	}
	for id := range got.Cells {
		ids[id] = true
	}
	sorted := make([]string, 0, len(ids))
	for id := range ids {
		sorted = append(sorted, id)
	}
	sort.Strings(sorted)
	for _, id := range sorted {
		for _, lv := range levels {
			g, gok := got.Cells[id][string(lv)]
			w, wok := want.Cells[id][string(lv)]
			if gok != wok {
				out = append(out, fmt.Sprintf("%s/%s: present in got=%v want=%v", id, lv, gok, wok))
				continue
			}
			gb, _ := json.Marshal(g)
			wb, _ := json.Marshal(w)
			if string(gb) != string(wb) {
				out = append(out, fmt.Sprintf("%s/%s: got %s want %s", id, lv, gb, wb))
			}
		}
	}
	return out
}

// LevelsFromEnv is a helper for tests and the CLI: parse "RU,RC".
func ParseLevels(s string) ([]trace.Level, error) {
	var out []trace.Level
	for _, p := range strings.Split(s, ",") {
		l := trace.Level(strings.TrimSpace(p))
		if !l.Valid() {
			return nil, fmt.Errorf("unknown level %q", p)
		}
		out = append(out, l)
	}
	return out, nil
}
