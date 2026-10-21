package conformance

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

// ReportSchemaVersion is bumped when the shape of conformance.json changes.
const ReportSchemaVersion = 1

// Divergence is one curated knownDivergences entry. Cause is plain English;
// when it has not been established it says exactly "cause not yet established".
type Divergence struct {
	ID          string         `json:"id"`
	Title       string         `json:"title"`
	Levels      []string       `json:"levels"`
	Cause       string         `json:"cause"`
	Established bool           `json:"causeEstablished"`
	Signatures  []string       `json:"signatures"`            // patterns over Signature(); a random mismatch matching one is covered by this entry
	Regression  string         `json:"regression"`            // file name under engine/testdata/regressions
	Schedule    string         `json:"schedule"`              // the regression schedule's source (filled in at load)
	Occurrences map[string]int `json:"occurrences,omitempty"` // level -> random schedules that showed it (filled in by BuildReport)
}

// LoadDivergences reads the curated file and attaches each regression
// schedule's text. A missing file means no divergences.
func LoadDivergences(path, regressionsDir string) ([]Divergence, error) {
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return []Divergence{}, nil
	}
	if err != nil {
		return nil, err
	}
	var ds []Divergence
	if err := json.Unmarshal(b, &ds); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	for i := range ds {
		d := &ds[i]
		if d.Regression == "" {
			return nil, fmt.Errorf("divergence %s has no regression schedule", d.ID)
		}
		src, err := os.ReadFile(filepath.Join(regressionsDir, d.Regression))
		if err != nil {
			return nil, fmt.Errorf("divergence %s: %w", d.ID, err)
		}
		d.Schedule = strings.ReplaceAll(string(src), "\r\n", "\n")
		if !d.Established && d.Cause != "cause not yet established" {
			return nil, fmt.Errorf("divergence %s: an unestablished cause must read exactly %q", d.ID, "cause not yet established")
		}
	}
	return ds, nil
}

// Signature classifies a mismatch by level and the kinds of difference seen.
func Signature(e *Eval) string {
	prefix := ""
	if e.RaceRisk {
		prefix = "race/fixed:"
		if e.Variants > 1 {
			prefix = "race/varies:"
		}
	}
	kinds := map[string]bool{}
	for _, d := range e.Diffs {
		switch {
		case strings.HasPrefix(d, "anomalies"):
			kinds["anomaly"] = true
		case strings.HasPrefix(d, "final state"):
			kinds["final"] = true
		case strings.HasPrefix(d, "abort set"):
			kinds["abortset"] = true
		case strings.HasPrefix(d, "deadlock"):
			kinds["deadlock"] = true
		case strings.Contains(d, ": status "):
			kinds["status"] = true
		case strings.Contains(d, ": abort class "):
			kinds["abortclass"] = true
		case strings.Contains(d, ": read "):
			kinds["read"] = true
		case strings.Contains(d, ": rows "):
			kinds["rows"] = true
		case strings.Contains(d, ": wrote "):
			kinds["wrote"] = true
		}
	}
	var ks []string
	for k := range kinds {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	kind := ""
	if e.Level == trace.SER {
		kind = SERKind(e) + ":"
	}
	return string(e.Level) + ":" + kind + prefix + strings.Join(ks, "+")
}

// CannedLevel is one cell of the per-scenario comparison.
type CannedLevel struct {
	Engine     Cell     `json:"engine"`
	Postgres   Cell     `json:"postgres"`
	ClassMatch bool     `json:"classMatch"` // same invariant outcome (occurs / prevented)
	Identical  bool     `json:"identical"`  // same statements, final state and abort set
	Diffs      []string `json:"diffs"`
}

// CannedEntry is the comparison of one canned scenario.
type CannedEntry struct {
	Scenario string                 `json:"scenario"`
	Title    string                 `json:"title"`
	Levels   map[string]CannedLevel `json:"levels"`
}

// HarnessInfo documents how the numbers were produced.
type HarnessInfo struct {
	Reruns            int `json:"reruns"`
	BlockedAfterMs    int `json:"blockedAfterMs"`
	UnblockWaitMs     int `json:"unblockWaitMs"`
	Workers           int `json:"workers"`
	WallSeconds       int `json:"wallSeconds"`
	StabilityRepeats  int `json:"stabilityRepeats"`
	StabilityPairs    int `json:"stabilityPairs"`
	StabilityUnstable int `json:"stabilityUnstable"`
	// Evaluations is the number of (schedule, level) comparisons made;
	// RerunMismatches how many of them were re-run; UnstableReruns how many of
	// those re-runs disagreed with each other.
	Evaluations     int `json:"evaluations"`
	RerunMismatches int `json:"rerunMismatches"`
	UnstableReruns  int `json:"unstableReruns"`
}

// Unexplained is a reproducing mismatch no divergence covers.
type Unexplained struct {
	Case      string   `json:"case"`
	Level     string   `json:"level"`
	Signature string   `json:"signature"`
	Diffs     []string `json:"diffs"`
	Schedule  string   `json:"schedule"`
}

// Corpus describes what was run.
type Corpus struct {
	SeedBase       uint64 `json:"seedBase"`
	RandomPerLevel int    `json:"randomPerLevel"`
	NoDelete       bool   `json:"noDelete"`
}

// Report is web/public/conformance.json.
type Report struct {
	SchemaVersion    int                    `json:"schemaVersion"`
	EngineVersion    string                 `json:"engineVersion"`
	PostgresVersion  string                 `json:"postgresVersion"`
	Corpus           Corpus                 `json:"corpus"`
	Harness          HarnessInfo            `json:"harness"`
	Canned           []CannedEntry          `json:"canned"`
	ReadUncommitted  *RUProbe               `json:"readUncommitted"`
	Random           map[string]LevelTotals `json:"random"`
	KnownDivergences []Divergence           `json:"knownDivergences"`
	Unexplained      []Unexplained          `json:"unexplained"`
}

// BuildReport assembles the report. Reproducing mismatches are matched against
// the curated divergences by signature; the rest end up in Unexplained.
func BuildReport(pgVersion string, canned []Case, cannedEvals []*Eval, randCases []Case, randEvals []*Eval, divs []Divergence) *Report {
	r := &Report{
		SchemaVersion:    ReportSchemaVersion,
		EngineVersion:    trace.EngineVersion,
		PostgresVersion:  pgVersion,
		Corpus:           Corpus{SeedBase: SeedBase, RandomPerLevel: len(randCases), NoDelete: true},
		Random:           map[string]LevelTotals{},
		KnownDivergences: divs,
		Unexplained:      []Unexplained{},
	}
	if r.KnownDivergences == nil {
		r.KnownDivergences = []Divergence{}
	}
	for i := range r.KnownDivergences {
		r.KnownDivergences[i].Occurrences = map[string]int{}
	}
	r.Harness = HarnessInfo{Reruns: Reruns, BlockedAfterMs: int(DefaultTiming.BlockedAfter.Milliseconds()), UnblockWaitMs: int(DefaultTiming.UnblockWait.Milliseconds())}

	byName := map[string]Case{}
	for _, c := range randCases {
		byName[c.Name] = c
	}
	for _, c := range canned {
		entry := CannedEntry{Scenario: c.SC.ID, Title: c.SC.Title, Levels: map[string]CannedLevel{}}
		for _, e := range cannedEvals {
			if e == nil || e.Case != c.Name {
				continue
			}
			entry.Levels[string(e.Level)] = CannedLevel{
				Engine: e.EngineCell, Postgres: e.PGCell,
				ClassMatch: e.EngineCell.Invariant == e.PGCell.Invariant,
				Identical:  !e.Mismatch,
				Diffs:      nonNil(e.Diffs),
			}
			r.Harness.Evaluations++
			if len(e.Rerun) > 0 {
				r.Harness.RerunMismatches++
				if e.Unstable {
					r.Harness.UnstableReruns++
				}
			}
		}
		r.Canned = append(r.Canned, entry)
	}
	for _, lv := range Levels {
		t := Summarize(lv, randEvals)
		for _, e := range randEvals {
			if e == nil || e.Level != lv {
				continue
			}
			r.Harness.Evaluations++
			if len(e.Rerun) > 0 {
				r.Harness.RerunMismatches++
				if e.Unstable {
					r.Harness.UnstableReruns++
				}
			}
		}
		for _, e := range Mismatches(randEvals, lv) {
			if !e.Mismatch || (e.Unstable && !e.RaceRisk) {
				continue // SER abort-set statistics, or a harness flake (reported separately)
			}
			sig := Signature(e)
			matched := false
			for i := range r.KnownDivergences {
				for _, pat := range r.KnownDivergences[i].Signatures {
					if sigMatch(pat, sig) {
						r.KnownDivergences[i].Occurrences[string(lv)]++
						matched = true
						break
					}
				}
			}
			if matched {
				t.Explained++
			} else {
				t.Unexplained++
				r.Unexplained = append(r.Unexplained, Unexplained{
					Case: e.Case, Level: string(lv), Signature: sig, Diffs: e.Diffs,
					Schedule: ScheduleText(byName[e.Case].SC),
				})
			}
		}
		r.Random[string(lv)] = t
	}
	return r
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// JSON renders the report.
func (r *Report) JSON() ([]byte, error) {
	b, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(b, '\n'), nil
}

func pct(n, d int) string {
	if d == 0 {
		return "n/a"
	}
	return fmt.Sprintf("%.2f%%", 100*float64(n)/float64(d))
}

// Text is the console summary.
func (r *Report) Text() string {
	var b strings.Builder
	fmt.Fprintf(&b, "engine %s vs PostgreSQL %s; %d random schedules per level, seeds %d..%d, no DELETE\n",
		r.EngineVersion, r.PostgresVersion, r.Corpus.RandomPerLevel, r.Corpus.SeedBase, r.Corpus.SeedBase+uint64(r.Corpus.RandomPerLevel)-1)
	cm, ci := 0, 0
	for _, c := range r.Canned {
		for _, l := range c.Levels {
			ci++
			if l.ClassMatch {
				cm++
			}
		}
	}
	fmt.Fprintf(&b, "canned: %d/%d cells with the same occurs/prevented outcome\n", cm, ci)
	for _, c := range r.Canned {
		for _, lv := range Levels {
			if l, ok := c.Levels[string(lv)]; ok && !l.Identical {
				fmt.Fprintf(&b, "  canned %s %s not identical: %v\n", c.Scenario, lv, l.Diffs)
			}
		}
	}
	for _, lv := range Levels {
		if _, ok := r.Random[string(lv)]; !ok {
			continue
		}
		t := r.Random[string(lv)]
		fmt.Fprintf(&b, "%-3s schedules=%d deadlock=%d (class agreed %d) compared=%d identical=%d (%s) mismatches=%d reproducing=%d unstable=%d explained=%d unexplained=%d\n",
			lv, t.Schedules, t.DeadlockSchedules, t.DeadlockClassAgreed, t.Compared, t.Identical, pct(t.Identical, t.Compared),
			t.Mismatches, t.Reproducing, t.UnstableRace+t.UnstableOther, t.Explained, t.Unexplained)
		fmt.Fprintf(&b, "    waiter races: %d schedules, PostgreSQL varied in %d; mismatches with a race %d; unstable without a race %d\n", t.RaceSchedules, t.RaceVariants, t.MismatchesRace, t.UnstableOther)
		fmt.Fprintf(&b, "    without simultaneous blocking: %d/%d identical (%s); with it: PostgreSQL produced the engine's history in %d of %d\n", t.NoRaceIdentical, t.NoRaceCompared, pct(t.NoRaceIdentical, t.NoRaceCompared), t.RaceEngineSeen, t.RaceSchedules)
		if lv == trace.SER {
			fmt.Fprintf(&b, "    serializable: engine %d/%d, postgres %d/%d\n", t.EngineSerializable, t.Schedules, t.PGSerializable, t.Schedules)
			fmt.Fprintf(&b, "    abort sets identical %d (%s); engine aborts more %d (%s); fewer %d (%s); differ same count %d; fewer-but-not-serializable %d\n",
				t.AbortSetsIdentical, pct(t.AbortSetsIdentical, t.Schedules), t.EngineAbortsMore, pct(t.EngineAbortsMore, t.Schedules),
				t.EngineAbortsFewer, pct(t.EngineAbortsFewer, t.Schedules), t.AbortsDifferSame, t.FewerNotSerial)
		}
	}
	if p := r.ReadUncommitted; p != nil {
		fmt.Fprintf(&b, "READ UNCOMMITTED on PostgreSQL: dirty read observed=%v, same history as READ COMMITTED=%v\n", p.DirtyReadObserved, p.SameAsReadCommited)
	}
	h := r.Harness
	fmt.Fprintf(&b, "harness: %d evaluations, %d re-run (5x), %d unstable; canned self-check %d/%d unstable over %d repeats; %d s wall\n",
		h.Evaluations, h.RerunMismatches, h.UnstableReruns, h.StabilityUnstable, h.StabilityPairs, h.StabilityRepeats, h.WallSeconds)
	return b.String()
}

// Failing returns why the run must not be accepted, or "".
func (r *Report) Failing() string {
	var why []string
	if r.ReadUncommitted == nil {
		why = append(why, "no READ UNCOMMITTED probe")
	}
	for _, c := range r.Canned {
		for lv, l := range c.Levels {
			if !l.ClassMatch && !r.documented(c.Scenario, lv) {
				why = append(why, fmt.Sprintf("canned %s %s differs from PostgreSQL and is not documented", c.Scenario, lv))
			}
		}
	}
	for _, lv := range Levels {
		if _, ok := r.Random[string(lv)]; !ok {
			continue
		}
		t := r.Random[string(lv)]
		if t.UnstableOther > 0 {
			why = append(why, fmt.Sprintf("%s: %d mismatches did not reproduce and no waiters raced (harness timing)", lv, t.UnstableOther))
		}
		if t.Unexplained > 0 {
			why = append(why, fmt.Sprintf("%s: %d unexplained mismatches", lv, t.Unexplained))
		}
		if lv == trace.SER {
			if t.EngineSerializable != t.Schedules || t.PGSerializable != t.Schedules {
				why = append(why, fmt.Sprintf("SER: not all histories serializable (engine %d, postgres %d of %d)", t.EngineSerializable, t.PGSerializable, t.Schedules))
			}
		}
	}
	return strings.Join(why, "; ")
}

func (r *Report) documented(scenario, level string) bool {
	for _, d := range r.KnownDivergences {
		if strings.HasPrefix(d.Regression, scenario) {
			for _, l := range d.Levels {
				if l == level {
					return true
				}
			}
		}
	}
	return false
}

var _ = dsl.Format

// sigMatch compares a divergence signature with a mismatch signature; `*` in
// the pattern matches any run of characters (including `/` and `:`).
func sigMatch(pattern, sig string) bool {
	parts := strings.Split(pattern, "*")
	if len(parts) == 1 {
		return pattern == sig
	}
	if !strings.HasPrefix(sig, parts[0]) {
		return false
	}
	rest := sig[len(parts[0]):]
	for _, p := range parts[1 : len(parts)-1] {
		i := strings.Index(rest, p)
		if i < 0 {
			return false
		}
		rest = rest[i+len(p):]
	}
	return strings.HasSuffix(rest, parts[len(parts)-1])
}

// MergeReports combines the reports of per-level shards (same engine,
// PostgreSQL and corpus) into one. Totals stay per level; harness counters add up.
func MergeReports(rs []*Report) (*Report, error) {
	if len(rs) == 0 {
		return nil, fmt.Errorf("nothing to merge")
	}
	out := *rs[0]
	out.Canned = nil
	out.Random = map[string]LevelTotals{}
	out.Unexplained = []Unexplained{}
	out.Harness = HarnessInfo{Reruns: rs[0].Harness.Reruns, BlockedAfterMs: rs[0].Harness.BlockedAfterMs, UnblockWaitMs: rs[0].Harness.UnblockWaitMs, Workers: rs[0].Harness.Workers, StabilityRepeats: rs[0].Harness.StabilityRepeats}
	out.KnownDivergences = append([]Divergence(nil), rs[0].KnownDivergences...)
	for i := range out.KnownDivergences {
		out.KnownDivergences[i].Occurrences = map[string]int{}
	}
	byScenario := map[string]*CannedEntry{}
	var order []string
	for _, r := range rs {
		if r.EngineVersion != rs[0].EngineVersion || r.PostgresVersion != rs[0].PostgresVersion || r.Corpus != rs[0].Corpus {
			return nil, fmt.Errorf("shards disagree on engine version, PostgreSQL version or corpus")
		}
		for _, c := range r.Canned {
			e := byScenario[c.Scenario]
			if e == nil {
				cc := CannedEntry{Scenario: c.Scenario, Title: c.Title, Levels: map[string]CannedLevel{}}
				e = &cc
				byScenario[c.Scenario] = e
				order = append(order, c.Scenario)
			}
			for lv, l := range c.Levels {
				e.Levels[lv] = l
			}
		}
		for lv, t := range r.Random {
			if _, dup := out.Random[lv]; dup {
				return nil, fmt.Errorf("level %s appears in two shards", lv)
			}
			out.Random[lv] = t
		}
		for i, d := range r.KnownDivergences {
			for lv, n := range d.Occurrences {
				out.KnownDivergences[i].Occurrences[lv] += n
			}
		}
		out.Unexplained = append(out.Unexplained, r.Unexplained...)
		h := r.Harness
		out.Harness.StabilityPairs += h.StabilityPairs
		out.Harness.StabilityUnstable += h.StabilityUnstable
		out.Harness.Evaluations += h.Evaluations
		out.Harness.RerunMismatches += h.RerunMismatches
		out.Harness.UnstableReruns += h.UnstableReruns
		if h.WallSeconds > out.Harness.WallSeconds {
			out.Harness.WallSeconds = h.WallSeconds // shards run in parallel
		}
		if out.ReadUncommitted == nil {
			out.ReadUncommitted = r.ReadUncommitted
		}
	}
	for _, s := range order {
		out.Canned = append(out.Canned, *byScenario[s])
	}
	return &out, nil
}
