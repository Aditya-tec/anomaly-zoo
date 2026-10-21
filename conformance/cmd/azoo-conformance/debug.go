package main

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/Aditya-tec/anomaly-zoo/conformance"
	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/gen"
	"github.com/Aditya-tec/anomaly-zoo/engine/oracle"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

// debugCase runs one case n times and prints the engine history and each
// distinct PostgreSQL history. spec is "seed-N" or a path to an .azs file.
func debugCase(ctx context.Context, dsn, spec, level string, n int) error {
	sc, err := loadCase(spec)
	if err != nil {
		return err
	}
	lv := trace.Level(level)
	fmt.Println(dsl.Format(sc))
	eng, _, err := conformance.RunEngine(sc, lv)
	if err != nil {
		return err
	}
	if os.Getenv("AZOO_EVENTS") != "" {
		if err := printEvents(sc, lv); err != nil {
			return err
		}
	}
	fmt.Println("ENGINE:")
	fmt.Println(conformance.Describe(sc, eng))
	r, err := conformance.NewRunner(ctx, dsn, "az_dbg")
	if err != nil {
		return err
	}
	defer r.Close(ctx)
	seen := map[string]int{}
	var order []string
	hist := map[string]*conformance.History{}
	for i := 0; i < n; i++ {
		h, err := r.Run(ctx, sc, lv)
		if err != nil {
			return err
		}
		fp := conformance.Fingerprint(h)
		if _, ok := seen[fp]; !ok {
			order = append(order, fp)
			hist[fp] = h
		}
		seen[fp]++
	}
	for i, fp := range order {
		h := hist[fp]
		fmt.Printf("POSTGRES variant %d (%d/%d runs): diffs vs engine: %v\n", i+1, seen[fp], n, conformance.Diff(eng, h))
		fmt.Println(conformance.Describe(sc, h))
	}
	return nil
}

// printEvents dumps the engine's events with their lock effects.
func printEvents(sc *dsl.Scenario, lv trace.Level) error {
	_, tr, err := conformance.RunEngine(sc, lv)
	if err != nil {
		return err
	}
	for _, e := range tr.Steps {
		fmt.Printf("ev%-3d sched=%-3d %s %-6s %-8s %s", e.Index, e.ScheduledIndex, e.Txn, e.Op, e.Status, e.Reason)
		if e.BlockedOn != "" {
			fmt.Printf(" blockedOn=%s", e.BlockedOn)
		}
		for _, f := range e.Effects {
			fmt.Printf(" [%s txn=%s key=%s holder=%s reason=%s]", f.Kind, f.Txn, f.Key, f.Holder, f.Reason)
		}
		fmt.Println()
	}
	return nil
}

// shrinkCase minimises spec to the smallest schedule on which PostgreSQL
// disagrees with the engine in every one of `runs` consecutive runs.
func shrinkCase(ctx context.Context, dsn, spec, level, kind string, runs int) error {
	sc, err := loadCase(spec)
	if err != nil {
		return err
	}
	lv := trace.Level(level)
	r, err := conformance.NewRunner(ctx, dsn, "az_shrink")
	if err != nil {
		return err
	}
	defer r.Close(ctx)
	fails := func(c *dsl.Scenario) bool {
		eng, _, err := conformance.RunEngine(c, lv)
		if err != nil {
			return false
		}
		for i := 0; i < runs; i++ {
			pg, err := r.Run(ctx, c, lv)
			if err != nil || !conformance.Mismatch(eng, pg) {
				return false
			}
			if kind != "" && conformance.KindOf(eng, pg) != kind {
				return false
			}
			if pg.RaceRisk {
				return false // minimal schedules for the non-race kinds must not need two blocked statements
			}
		}
		return true
	}
	if !fails(sc) {
		return fmt.Errorf("%s does not mismatch %d times in a row at %s", spec, runs, level)
	}
	small := oracle.Shrink(sc, fails)
	fmt.Println(dsl.Format(small))
	return nil
}

// loadCase accepts "seed-N" (the P8 generator) or a path to an .azs file.
func loadCase(spec string) (*dsl.Scenario, error) {
	if strings.HasPrefix(spec, "seed-") {
		seed, err := strconv.ParseUint(strings.TrimPrefix(spec, "seed-"), 10, 64)
		if err != nil {
			return nil, err
		}
		return gen.Generate(seed, gen.Config{NoDelete: true}), nil
	}
	src, err := readFile(spec)
	if err != nil {
		return nil, err
	}
	sc, errs := dsl.Parse(src)
	if len(errs) > 0 {
		return nil, fmt.Errorf("%v", errs)
	}
	return sc, nil
}
