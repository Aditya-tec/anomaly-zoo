// Command azoo-conformance runs the PostgreSQL differential harness (spec
// §9.4) and writes the conformance report.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/Aditya-tec/anomaly-zoo/conformance"
	"github.com/Aditya-tec/anomaly-zoo/engine/matrix"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

func main() {
	var (
		random         = flag.Int("random", 500, "random schedules per level")
		workers        = flag.Int("workers", 4, "parallel runners (one schema each)")
		scenarios      = flag.String("scenarios", "../scenarios", "directory of canned .azs scenarios")
		out            = flag.String("out", "", "write the report JSON here")
		show           = flag.Int("show", 12, "print this many mismatches per level")
		stab           = flag.Int("stability", 10, "repeat each canned (scenario, level) this often to measure the harness flake rate")
		divergent      = flag.String("divergences", "divergences.json", "curated knownDivergences file")
		debug          = flag.String("debug", "", "investigate one case: seed-N or a path to an .azs file")
		pad            = flag.Int("pad", 0, "with -debug: filler rows after every key the schedule uses (page-granularity control)")
		stepsFlag      = flag.String("abort-steps", "", "print the statement at which each side aborts each transaction")
		hintDetailFlag = flag.String("hint-detail", "", "print the abort sets of every control variant of a case")
		hintsFlag      = flag.String("hints", "", "print the control-experiment hints for a case")
		ctl            = flag.String("controls", "", "control experiments on a case: add a write to read-only transactions, turn scripted ABORTs into COMMITs")
		verify         = flag.String("verify", "", "re-derive spec 4.8 and 4.6 from the engine trace for every engine abort (seed-N or .azs path)")
		explain        = flag.String("explain", "", "list the engine-only aborts of a case and how they arose (seed-N or .azs path)")
		shrink         = flag.String("shrink", "", "minimise a case on which PostgreSQL disagrees with the engine 5 runs in a row")
		kindFlag       = flag.String("kind", "", "with -shrink at SER: keep the abort-set kind (identical, more, fewer, same-count)")
		dlevel         = flag.String("level", "RC", "level for -debug")
		dn             = flag.Int("n", 20, "repetitions for -debug")
		seedList       = flag.String("seeds", "", "comma-separated seeds to run instead of the first -random seeds (investigations)")
		levelList      = flag.String("levels", "RC,SI,SER", "levels to run (a nightly shard runs one)")
		rerunRace      = flag.Bool("rerun-race", true, "also re-run matching schedules that had simultaneous blocking (off: re-run actual mismatches only)")
		summary        = flag.String("summary", "", "append a markdown summary (totals, divergences, unexplained mismatches with hints) to this file, e.g. $GITHUB_STEP_SUMMARY")
		refresh        = flag.String("refresh-divergences", "", "update only knownDivergences in this existing report from divergences.json (no number changes)")
		merge          = flag.String("merge", "", "comma-separated shard reports to merge into -out (no PostgreSQL needed)")
		regress        = flag.String("regressions", "../engine/testdata/regressions", "directory holding the regression schedules")
	)
	flag.Parse()
	if *refresh != "" {
		mustRefresh(*refresh, *divergent, *regress)
		return
	}
	if *merge != "" {
		mustMerge(*merge, *out, *summary)
		return
	}
	conformance.RerunMatchedRace = *rerunRace
	conformance.Levels = parseLevels(*levelList)
	dsn := os.Getenv("CONFORMANCE_DATABASE_URL")
	if dsn == "" {
		fmt.Fprintln(os.Stderr, "CONFORMANCE_DATABASE_URL is not set")
		os.Exit(2)
	}
	ctx := context.Background()
	debugPad = *pad
	if *stepsFlag != "" {
		must(abortSteps(ctx, dsn, *stepsFlag))
		return
	}
	if *hintDetailFlag != "" {
		must(hintDetail(ctx, dsn, *hintDetailFlag))
		return
	}
	if *hintsFlag != "" {
		must(hintsFor(ctx, dsn, *hintsFlag))
		return
	}
	if *ctl != "" {
		must(controls(ctx, dsn, *ctl))
		return
	}
	if *verify != "" {
		must(verifyRules(*verify))
		return
	}
	if *explain != "" {
		must(explainExtra(ctx, dsn, *explain))
		return
	}
	if *shrink != "" {
		must(shrinkCase(ctx, dsn, *shrink, *dlevel, *kindFlag, 5))
		return
	}
	if *debug != "" {
		must(debugCase(ctx, dsn, *debug, *dlevel, *dn))
		return
	}
	start := time.Now()
	ver, err := conformance.ServerVersion(ctx, dsn)
	must(err)

	scs, err := matrix.Scenarios(*scenarios)
	must(err)
	var canned []conformance.Case
	for _, sc := range scs {
		canned = append(canned, conformance.Case{Name: sc.ID, Canned: true, SC: sc})
	}
	fmt.Printf("PostgreSQL %s, engine %s\n", ver, trace.EngineVersion)

	progress := func(label string) func(int, int) {
		last := time.Now()
		return func(d, t int) {
			if time.Since(last) > 15*time.Second || d == t {
				last = time.Now()
				fmt.Printf("  %s %d/%d (%s)\n", label, d, t, time.Since(start).Round(time.Second))
			}
		}
	}

	cannedEvals, err := conformance.RunAll(ctx, dsn, canned, 1, progress("canned"))
	must(err)
	randCases := conformance.RandomCases(*random)
	if *seedList != "" {
		var seeds []uint64
		for _, s := range strings.Split(*seedList, ",") {
			n, err := strconv.ParseUint(strings.TrimSpace(s), 10, 64)
			must(err)
			seeds = append(seeds, n)
		}
		randCases = conformance.RandomCasesAt(seeds)
	}
	randEvals, err := conformance.RunAll(ctx, dsn, randCases, *workers, progress("random"))
	must(err)

	pairs, unstable := 0, 0
	if *stab > 1 {
		pairs, unstable, err = conformance.StabilityCheck(ctx, dsn, canned, *stab)
		must(err)
	}

	div, err := conformance.LoadDivergences(*divergent, *regress)
	must(err)
	rep := conformance.BuildReport(ver, canned, cannedEvals, randCases, randEvals, div)
	for _, c := range canned {
		if c.SC.ID == "dirty-read" {
			rep.ReadUncommitted, err = conformance.ProbeReadUncommitted(ctx, dsn, c.SC)
			must(err)
		}
	}
	rep.Harness.StabilityPairs, rep.Harness.StabilityUnstable, rep.Harness.StabilityRepeats = pairs, unstable, *stab
	rep.Harness.Workers = *workers
	rep.Harness.WallSeconds = int(time.Since(start).Seconds())

	fmt.Println()
	fmt.Println(rep.Text())
	for _, lv := range conformance.Levels {
		ms := conformance.Mismatches(randEvals, lv)
		for i, e := range ms {
			if i >= *show {
				fmt.Printf("  ... %d more %s mismatches\n", len(ms)-i, lv)
				break
			}
			kind := ""
			if lv == trace.SER {
				kind = " [" + conformance.SERKind(e) + "]"
			}
			fmt.Printf("--- %s %s%s race=%v variants=%d unstable=%v reruns-matching-engine=%d/%d\n", e.Case, lv, kind, e.RaceRisk, e.Variants, e.Unstable, e.RerunMatches, len(e.Rerun))
			if len(e.Hints) > 0 {
				fmt.Printf("    hints %v; minimal schedule has %d steps; engine aborts %s, postgres aborts %s\n", e.Hints, strings.Count(e.Shrunk, "\n  T"), conformance.AbortsString(e.Engine), conformance.AbortsString(e.PG))
			}
			for _, r := range conformance.PGAbortReasons(e) {
				fmt.Println("    pg abort", r)
			}
			for _, d := range e.Diffs {
				fmt.Println("   ", d)
			}
		}
	}
	writeSummary(*summary, rep)
	if *out != "" {
		b, err := rep.JSON()
		must(err)
		must(os.WriteFile(*out, b, 0o644))
		fmt.Println("wrote", *out)
	}
	if rep.Failing() != "" {
		fmt.Println("FAIL:", strings.TrimSpace(rep.Failing()))
		os.Exit(1)
	}
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func parseLevels(s string) []trace.Level {
	var out []trace.Level
	for _, p := range strings.Split(s, ",") {
		switch l := trace.Level(strings.TrimSpace(p)); l {
		case trace.RC, trace.SI, trace.SER:
			out = append(out, l)
		default:
			must(fmt.Errorf("level %q is not compared with PostgreSQL (RC, SI, SER)", p))
		}
	}
	return out
}

// mustMerge reads the shard reports, writes the merged report to out, prints
// the summary and exits non-zero when the merged report fails.
func mustMerge(list, out, summary string) {
	var rs []*conformance.Report
	for _, p := range strings.Split(list, ",") {
		b, err := os.ReadFile(strings.TrimSpace(p))
		must(err)
		var r conformance.Report
		must(json.Unmarshal(b, &r))
		rs = append(rs, &r)
	}
	m, err := conformance.MergeReports(rs)
	must(err)
	fmt.Println(m.Text())
	writeSummary(summary, m)
	if out != "" {
		b, err := m.JSON()
		must(err)
		must(os.WriteFile(out, b, 0o644))
		fmt.Println("wrote", out)
	}
	if w := m.Failing(); w != "" {
		fmt.Println("FAIL:", strings.TrimSpace(w))
		os.Exit(1)
	}
}

// writeSummary appends the markdown summary to path (a no-op when path is empty).
func writeSummary(path string, r *conformance.Report) {
	if path == "" {
		return
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	must(err)
	defer f.Close()
	_, err = f.WriteString(r.Summary() + "\n")
	must(err)
}

// mustRefresh replaces knownDivergences in an existing report with the curated file's entries, keeping the
// occurrence counts that report recorded for entries it already had. Nothing else changes.
func mustRefresh(path, divergences, regressions string) {
	b, err := os.ReadFile(path)
	must(err)
	var r conformance.Report
	must(json.Unmarshal(b, &r))
	old := map[string]map[string]int{}
	for _, d := range r.KnownDivergences {
		old[d.ID] = d.Occurrences
	}
	ds, err := conformance.LoadDivergences(divergences, regressions)
	must(err)
	for i := range ds {
		ds[i].Occurrences = old[ds[i].ID]
	}
	r.KnownDivergences = ds
	out, err := r.JSON()
	must(err)
	must(os.WriteFile(path, out, 0o644))
	fmt.Printf("%s: knownDivergences refreshed (%d entries)\n", path, len(ds))
}
