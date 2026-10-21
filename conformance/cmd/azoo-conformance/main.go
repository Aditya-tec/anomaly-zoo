// Command azoo-conformance runs the PostgreSQL differential harness (spec
// §9.4) and writes the conformance report.
package main

import (
	"context"
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
		random    = flag.Int("random", 500, "random schedules per level")
		workers   = flag.Int("workers", 4, "parallel runners (one schema each)")
		scenarios = flag.String("scenarios", "../scenarios", "directory of canned .azs scenarios")
		out       = flag.String("out", "", "write the report JSON here")
		show      = flag.Int("show", 12, "print this many mismatches per level")
		stab      = flag.Int("stability", 10, "repeat each canned (scenario, level) this often to measure the harness flake rate")
		divergent = flag.String("divergences", "divergences.json", "curated knownDivergences file")
		debug     = flag.String("debug", "", "investigate one case: seed-N or a path to an .azs file")
		shrink    = flag.String("shrink", "", "minimise a case on which PostgreSQL disagrees with the engine 5 runs in a row")
		kindFlag  = flag.String("kind", "", "with -shrink at SER: keep the abort-set kind (identical, more, fewer, same-count)")
		dlevel    = flag.String("level", "RC", "level for -debug")
		dn        = flag.Int("n", 20, "repetitions for -debug")
		seedList  = flag.String("seeds", "", "comma-separated seeds to run instead of the first -random seeds (investigations)")
		regress   = flag.String("regressions", "../engine/testdata/regressions", "directory holding the regression schedules")
	)
	flag.Parse()
	dsn := os.Getenv("CONFORMANCE_DATABASE_URL")
	if dsn == "" {
		fmt.Fprintln(os.Stderr, "CONFORMANCE_DATABASE_URL is not set")
		os.Exit(2)
	}
	ctx := context.Background()
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
			for _, r := range conformance.PGAbortReasons(e) {
				fmt.Println("    pg abort", r)
			}
			for _, d := range e.Diffs {
				fmt.Println("   ", d)
			}
		}
	}
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
