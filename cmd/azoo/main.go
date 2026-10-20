// Command azoo is the Anomaly Zoo command line (spec §5.10).
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/gen"
	"github.com/Aditya-tec/anomaly-zoo/engine/matrix"
	"github.com/Aditya-tec/anomaly-zoo/engine/oracle"
	"github.com/Aditya-tec/anomaly-zoo/engine/run"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

const usage = `usage:
  azoo run <file.azs> --level SER [--json]
  azoo matrix <scenarios-dir> [--check]
  azoo traces --out <dir> [--scenarios <dir>]
  azoo gen --seed N --count M --level L [--txns 4] [--keys 5]
  azoo version
`

func main() { os.Exit(realMain(os.Args[1:], os.Stdout, os.Stderr)) }

func realMain(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, usage)
		return 2
	}
	var err error
	switch args[0] {
	case "run":
		err = cmdRun(args[1:], stdout)
	case "matrix":
		err = cmdMatrix(args[1:], stdout)
	case "traces":
		err = cmdTraces(args[1:], stdout)
	case "gen":
		err = cmdGen(args[1:], stdout)
	case "version":
		fmt.Fprintln(stdout, trace.EngineVersion)
	case "-h", "--help", "help":
		fmt.Fprint(stdout, usage)
	default:
		fmt.Fprintf(stderr, "unknown command %q\n%s", args[0], usage)
		return 2
	}
	if err != nil {
		fmt.Fprintln(stderr, "azoo:", err)
		return 1
	}
	return 0
}

// parseFlags lets flags appear before or after positional arguments.
func parseFlags(fs *flag.FlagSet, args []string) ([]string, error) {
	fs.SetOutput(io.Discard)
	var pos []string
	for len(args) > 0 {
		if err := fs.Parse(args); err != nil {
			return nil, err
		}
		args = fs.Args()
		if len(args) > 0 {
			pos = append(pos, args[0])
			args = args[1:]
		}
	}
	return pos, nil
}

func loadScenario(path string) (*dsl.Scenario, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	sc, errs := dsl.Parse(string(b))
	if len(errs) > 0 {
		var sb strings.Builder
		for _, e := range errs {
			fmt.Fprintf(&sb, "%s:%s\n", path, e.Error())
		}
		return nil, fmt.Errorf("%s", strings.TrimRight(sb.String(), "\n"))
	}
	return sc, nil
}

func cmdRun(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("run", flag.ContinueOnError)
	level := fs.String("level", "SER", "RU|RC|SI|SER")
	asJSON := fs.Bool("json", false, "print the trace as canonical JSON")
	pos, err := parseFlags(fs, args)
	if err != nil {
		return err
	}
	if len(pos) != 1 {
		return fmt.Errorf("run needs exactly one scenario file")
	}
	lv := trace.Level(*level)
	if !lv.Valid() {
		return fmt.Errorf("unknown level %q", *level)
	}
	sc, err := loadScenario(pos[0])
	if err != nil {
		return err
	}
	tr, err := run.Run(sc, lv)
	if err != nil {
		return err
	}
	if *asJSON {
		b, err := tr.Marshal()
		if err != nil {
			return err
		}
		_, err = fmt.Fprintf(out, "%s\n", b)
		return err
	}
	printHuman(out, tr)
	return nil
}

func printHuman(w io.Writer, tr *trace.Trace) {
	fmt.Fprintf(w, "%s at %s (digest %s)\n", tr.Scenario.ID, tr.Level, tr.Digest[:12])
	for _, e := range tr.Steps {
		mark := " "
		if e.Resumed {
			mark = "*"
		}
		line := fmt.Sprintf("%3d %s%s %-6s", e.Index, mark, e.Txn, e.Op)
		switch e.Op {
		case "READ", "PUT", "DELETE":
			line += " " + e.Args.Key
		case "SCAN":
			line += " " + e.Args.Prefix
		}
		if e.Args.Expr != "" {
			line += " = " + e.Args.Expr
		}
		if e.Args.Value != nil {
			line += fmt.Sprintf(" (=%d)", *e.Args.Value)
		}
		switch r := e.Result.(type) {
		case trace.ReadResult:
			if r.Absent {
				line += " -> absent"
			} else {
				line += fmt.Sprintf(" -> %d", r.Value)
			}
		case trace.ScanResult:
			line += fmt.Sprintf(" -> %d rows, sum %d", r.Count, r.Sum)
		}
		line += "  [" + e.Status
		if e.BlockedOn != "" {
			line += " on " + e.BlockedOn
		}
		if e.Reason != "" {
			line += ": " + e.Reason
		}
		fmt.Fprintln(w, line+"]")
	}
	fmt.Fprintln(w, "transactions:")
	for _, x := range tr.Txns {
		s := fmt.Sprintf("  %s %s", x.ID, x.Status)
		if x.AbortReason != nil {
			s += " (" + *x.AbortReason + ")"
		}
		fmt.Fprintln(w, s)
	}
	var kvs []string
	for _, kv := range tr.FinalState {
		kvs = append(kvs, fmt.Sprintf("%s=%d", kv.Key, kv.Value))
	}
	fmt.Fprintf(w, "final state: %s\n", strings.Join(kvs, " "))
	for _, inv := range tr.Invariants {
		fmt.Fprintf(w, "invariant %q: %s (%s)\n", inv.Name, inv.Status, inv.Detail)
	}
	if tr.Serializable.Verdict {
		fmt.Fprintf(w, "serializable: yes, witness order %s\n", strings.Join(tr.Serializable.WitnessOrder, ","))
	} else {
		fmt.Fprintln(w, "serializable: no")
	}
}

func cmdMatrix(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("matrix", flag.ContinueOnError)
	check := fs.Bool("check", false, "diff against <dir>/expected.json and fail on any difference")
	pos, err := parseFlags(fs, args)
	if err != nil {
		return err
	}
	if len(pos) != 1 {
		return fmt.Errorf("matrix needs exactly one scenarios directory")
	}
	m, err := matrix.Compute(pos[0], trace.Levels)
	if err != nil {
		return err
	}
	printMatrix(out, m)
	if !*check {
		return nil
	}
	want, err := matrix.Load(filepath.Join(pos[0], "expected.json"))
	if err != nil {
		return err
	}
	if diffs := matrix.Diff(m, want, trace.Levels); len(diffs) > 0 {
		return fmt.Errorf("matrix differs from expected.json:\n  %s", strings.Join(diffs, "\n  "))
	}
	if len(m.Cells) != len(want.Cells) {
		return fmt.Errorf("matrix has %d scenarios, expected.json has %d", len(m.Cells), len(want.Cells))
	}
	fmt.Fprintf(out, "OK: %d scenarios x %d levels match expected.json\n", len(m.Cells), len(trace.Levels))
	return nil
}

var catalogOrder = []string{"dirty-read", "non-repeatable-read", "phantom", "lost-update", "read-skew", "write-skew", "read-only-anomaly", "deadlock"}

// orderedIDs lists scenario ids in catalog order, unknown ids last (sorted).
func orderedIDs(cells map[string]map[string]matrix.Cell) []string {
	seen := map[string]bool{}
	var ids []string
	for _, id := range catalogOrder {
		if _, ok := cells[id]; ok {
			ids = append(ids, id)
			seen[id] = true
		}
	}
	var rest []string
	for id := range cells {
		if !seen[id] {
			rest = append(rest, id)
		}
	}
	sort.Strings(rest)
	return append(ids, rest...)
}

func printMatrix(w io.Writer, m *matrix.Matrix) {
	fmt.Fprintf(w, "%-22s", "")
	for _, lv := range trace.Levels {
		fmt.Fprintf(w, " %-4s", lv)
	}
	fmt.Fprintln(w, "  mechanism at SER")
	for _, id := range orderedIDs(m.Cells) {
		fmt.Fprintf(w, "%-22s", id)
		for _, lv := range trace.Levels {
			sym := "ok"
			if m.Cells[id][string(lv)].Invariant == "violated" {
				sym = "BUG"
			}
			fmt.Fprintf(w, " %-4s", sym)
		}
		fmt.Fprintf(w, "  %s\n", m.Cells[id]["SER"].Mechanism)
	}
}

type manifestTrace struct {
	File         string            `json:"file"`
	Digest       string            `json:"digest"`
	SHA256       string            `json:"sha256"`
	Bytes        int               `json:"bytes"`
	Invariant    string            `json:"invariant"`
	Serializable bool              `json:"serializable"`
	Aborts       map[string]string `json:"aborts"`
	Mechanism    string            `json:"mechanism"`
}

type manifestScenario struct {
	ID         string                   `json:"id"`
	Title      string                   `json:"title"`
	Story      string                   `json:"story"`
	Invariants []string                 `json:"invariants"`
	Traces     map[string]manifestTrace `json:"traces"`
}

type manifest struct {
	SchemaVersion int                `json:"schemaVersion"`
	EngineVersion string             `json:"engineVersion"`
	Levels        []string           `json:"levels"`
	Scenarios     []manifestScenario `json:"scenarios"`
}

func cmdTraces(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("traces", flag.ContinueOnError)
	dir := fs.String("out", "", "output directory (required)")
	scen := fs.String("scenarios", "scenarios", "scenarios directory")
	if _, err := parseFlags(fs, args); err != nil {
		return err
	}
	if *dir == "" {
		return fmt.Errorf("traces needs --out <dir>")
	}
	scs, err := matrix.Scenarios(*scen)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(*dir, 0o755); err != nil {
		return err
	}
	byID := map[string]*dsl.Scenario{}
	cells := map[string]map[string]matrix.Cell{}
	for _, sc := range scs {
		byID[sc.ID] = sc
		cells[sc.ID] = map[string]matrix.Cell{}
	}
	man := manifest{SchemaVersion: 1, EngineVersion: trace.EngineVersion}
	for _, lv := range trace.Levels {
		man.Levels = append(man.Levels, string(lv))
	}
	total := 0
	mf := map[string]*manifestScenario{}
	for _, id := range orderedIDs(cells) {
		sc := byID[id]
		ms := &manifestScenario{ID: sc.ID, Title: sc.Title, Story: sc.Story, Invariants: []string{}, Traces: map[string]manifestTrace{}}
		for _, inv := range sc.Invariants {
			ms.Invariants = append(ms.Invariants, inv.Name)
		}
		mf[id] = ms
		for _, lv := range trace.Levels {
			tr, err := run.Run(sc, lv)
			if err != nil {
				return err
			}
			b, err := tr.Marshal()
			if err != nil {
				return err
			}
			if err := trace.ValidateJSON(b); err != nil {
				return fmt.Errorf("%s@%s fails the schema: %w", id, lv, err)
			}
			name := fmt.Sprintf("%s.%s.json", id, lv)
			if err := os.WriteFile(filepath.Join(*dir, name), b, 0o644); err != nil {
				return err
			}
			sum := sha256.Sum256(b)
			cell := matrix.CellOf(tr)
			cells[id][string(lv)] = cell
			ms.Traces[string(lv)] = manifestTrace{
				File: name, Digest: tr.Digest, SHA256: hex.EncodeToString(sum[:]), Bytes: len(b),
				Invariant: cell.Invariant, Serializable: cell.Serializable, Aborts: cell.Aborts, Mechanism: cell.Mechanism,
			}
			total++
		}
		man.Scenarios = append(man.Scenarios, *ms)
	}
	mb, err := trace.CanonicalJSON(man)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(*dir, "manifest.json"), mb, 0o644); err != nil {
		return err
	}
	xb, err := trace.CanonicalJSON(matrix.Matrix{SchemaVersion: 1, Cells: cells})
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(*dir, "matrix.json"), xb, 0o644); err != nil {
		return err
	}
	fmt.Fprintf(out, "wrote %d traces, manifest.json (%d B) and matrix.json (%d B) to %s\n", total, len(mb), len(xb), *dir)
	return nil
}

func cmdGen(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("gen", flag.ContinueOnError)
	seed := fs.Uint64("seed", 1, "first seed")
	count := fs.Int("count", 1000, "number of schedules")
	level := fs.String("level", "SER", "RU|RC|SI|SER")
	txns := fs.Int("txns", 0, "transactions per schedule (0 = random 2-4)")
	keys := fs.Int("keys", 0, "keys to draw from, 2-5 (0 = 5)")
	if _, err := parseFlags(fs, args); err != nil {
		return err
	}
	lv := trace.Level(*level)
	if !lv.Valid() {
		return fmt.Errorf("unknown level %q", *level)
	}
	cfg := gen.Config{Txns: *txns, Keys: *keys}
	nonSer := 0
	for i := 0; i < *count; i++ {
		s := *seed + uint64(i)
		sc := gen.Generate(s, cfg)
		tr, m, err := run.Exec(sc, lv)
		if err == nil {
			err = run.Check(lv, tr, m)
		}
		if err != nil {
			fails := func(c *dsl.Scenario) bool {
				t2, m2, e2 := run.Exec(c, lv)
				return e2 != nil || run.Check(lv, t2, m2) != nil
			}
			min := oracle.Shrink(sc, fails)
			fmt.Fprintf(out, "FAILURE at seed %d (%s): %v\nminimal schedule:\n%s", s, lv, err, dsl.Format(min))
			return fmt.Errorf("property violated at seed %d", s)
		}
		if !tr.Serializable.Verdict {
			nonSer++
		}
	}
	fmt.Fprintf(out, "OK: %d schedules at %s (seeds %d..%d), %d non-serializable histories, no property violated\n",
		*count, lv, *seed, *seed+uint64(*count)-1, nonSer)
	return nil
}
