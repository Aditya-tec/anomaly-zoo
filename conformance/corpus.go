package conformance

import (
	"context"
	"fmt"
	"sort"
	"sync"

	"github.com/Aditya-tec/anomaly-zoo/engine/dsl"
	"github.com/Aditya-tec/anomaly-zoo/engine/gen"
	"github.com/Aditya-tec/anomaly-zoo/engine/trace"
)

// SeedBase is the first seed of the random corpus. Schedule i uses seed
// SeedBase+i at every level, so the 500-schedule corpus is the first 500 of the
// nightly 10,000.
const SeedBase uint64 = 8_000_000

// RandomCases builds n schedules with the P8 generator settings (no DELETE).
func RandomCases(n int) []Case {
	out := make([]Case, n)
	for i := range out {
		seed := SeedBase + uint64(i)
		out[i] = Case{Name: fmt.Sprintf("seed-%d", seed), SC: gen.Generate(seed, gen.Config{NoDelete: true})}
	}
	return out
}

type job struct {
	idx   int
	c     Case
	level trace.Level
}

// RunAll evaluates every case at every level in Levels using workers
// parallel runners (one PostgreSQL schema each). Results are returned in
// (case, level) order. progress, if set, is called after each evaluation.
func RunAll(ctx context.Context, dsn string, cases []Case, workers int, progress func(done, total int)) ([]*Eval, error) {
	if workers < 1 {
		workers = 1
	}
	total := len(cases) * len(Levels)
	out := make([]*Eval, total)
	jobs := make(chan job)
	var (
		wg       sync.WaitGroup
		mu       sync.Mutex
		firstErr error
		done     int
	)
	for w := 0; w < workers; w++ {
		r, err := NewRunner(ctx, dsn, fmt.Sprintf("az_w%d", w))
		if err != nil {
			return nil, err
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer r.Close(context.Background())
			for j := range jobs {
				e, err := Evaluate(ctx, r, j.c, j.level)
				mu.Lock()
				if err != nil && firstErr == nil {
					firstErr = err
				}
				out[j.idx] = e
				done++
				d := done
				mu.Unlock()
				if progress != nil {
					progress(d, total)
				}
			}
		}()
	}
	for i, c := range cases {
		for li, lv := range Levels {
			jobs <- job{idx: i*len(Levels) + li, c: c, level: lv}
		}
	}
	close(jobs)
	wg.Wait()
	return out, firstErr
}

// StabilityCheck runs every case at every level repeats times on PostgreSQL and
// counts the (case, level) pairs whose history was not identical every time.
// It measures the harness's own flake rate on schedules without any mismatch
// to explain.
func StabilityCheck(ctx context.Context, dsn string, cases []Case, repeats int) (pairs, unstable int, err error) {
	r, err := NewRunner(ctx, dsn, "az_stab")
	if err != nil {
		return 0, 0, err
	}
	defer r.Close(context.Background())
	for _, c := range cases {
		for _, lv := range Levels {
			var first string
			bad := false
			for i := 0; i < repeats; i++ {
				h, err := r.Run(ctx, c.SC, lv)
				if err != nil {
					return pairs, unstable, err
				}
				fp := Fingerprint(h)
				if i == 0 {
					first = fp
				} else if fp != first {
					bad = true
				}
			}
			pairs++
			if bad {
				unstable++
			}
		}
	}
	return pairs, unstable, nil
}

// LevelTotals are the random-corpus totals of one level.
type LevelTotals struct {
	Level     trace.Level `json:"level"`
	Schedules int         `json:"schedules"`

	// Schedules where either side has a deadlock victim are compared by outcome class only.
	DeadlockSchedules   int `json:"deadlockSchedules"`
	DeadlockClassAgreed int `json:"deadlockClassAgreed"`

	// Strictly compared (no deadlock on either side).
	Compared  int `json:"compared"`
	Identical int `json:"identical"` // statements, final state and abort sets all equal

	// Schedules in which two statements were blocked at the same time (in any
	// run). One commit or abort releases them together and PostgreSQL lets them
	// proceed concurrently, so its own outcome can vary from run to run.
	RaceSchedules   int `json:"raceSchedules"`
	NoRaceCompared  int `json:"noRaceCompared"`  // strictly compared schedules without that situation
	NoRaceIdentical int `json:"noRaceIdentical"` // of which identical
	RaceEngineSeen  int `json:"raceEngineSeen"`  // race schedules where PostgreSQL produced the engine's history in at least one run
	RaceVariants    int `json:"raceVariants"`    // of those, how many produced more than one PostgreSQL history over the re-runs

	// Mismatches (first run) after re-running them.
	Mismatches     int `json:"mismatches"`     // strict mismatches plus deadlock-class disagreements
	MismatchesRace int `json:"mismatchesRace"` // of which waiters raced
	Reproducing    int `json:"reproducing"`    // every re-run showed the same PostgreSQL history as the first run
	UnstableRace   int `json:"unstableRace"`   // re-runs disagreed, and waiters raced: PostgreSQL varies
	UnstableOther  int `json:"unstableOther"`  // re-runs disagreed with no race: the harness is at fault
	Explained      int `json:"explained"`      // covered by a knownDivergences entry
	Unexplained    int `json:"unexplained"`

	// SER only.
	EngineSerializable int `json:"engineSerializable"`
	PGSerializable     int `json:"postgresSerializable"`
	AbortSetsIdentical int `json:"abortSetsIdentical"`
	EngineAbortsMore   int `json:"engineAbortsMore"`
	EngineAbortsFewer  int `json:"engineAbortsFewer"`
	AbortsDifferSame   int `json:"abortSetsDifferSameCount"`
	FewerNotSerial     int `json:"engineAbortsFewerNotSerializable"`
}

// Summarize computes the totals of one level from its evaluations.
func Summarize(level trace.Level, evals []*Eval) LevelTotals {
	t := LevelTotals{Level: level}
	for _, e := range evals {
		if e.Level != level {
			continue
		}
		t.Schedules++
		if e.EngineSer {
			t.EngineSerializable++
		}
		if e.PGSer {
			t.PGSerializable++
		}
		if e.Deadlock {
			t.DeadlockSchedules++
			if e.DeadlockAgreed {
				t.DeadlockClassAgreed++
			}
		} else {
			t.Compared++
			if !e.Mismatch {
				t.Identical++
			}
		}
		if e.RaceRisk {
			t.RaceSchedules++
			if e.Variants > 1 {
				t.RaceVariants++
			}
			if !e.Mismatch || e.RerunMatches > 0 {
				t.RaceEngineSeen++
			}
		} else if !e.Deadlock {
			t.NoRaceCompared++
			if !e.Mismatch {
				t.NoRaceIdentical++
			}
		}
		if e.Mismatch {
			t.Mismatches++
			if e.RaceRisk {
				t.MismatchesRace++
			}
			switch {
			case !e.Unstable:
				t.Reproducing++
			case e.RaceRisk:
				t.UnstableRace++
			default:
				t.UnstableOther++
			}
		}
		if level == trace.SER {
			ne, np := len(e.Engine.SystemAborts()), len(e.PG.SystemAborts())
			switch {
			case !e.abortsDiffer():
				t.AbortSetsIdentical++
			case ne > np:
				t.EngineAbortsMore++
			case ne < np:
				t.EngineAbortsFewer++
				if !e.EngineSer {
					t.FewerNotSerial++
				}
			default:
				t.AbortsDifferSame++
			}
		}
	}
	return t
}

// Mismatches returns the evaluations that need classification, in order.
func Mismatches(evals []*Eval, level trace.Level) []*Eval {
	var out []*Eval
	for _, e := range evals {
		if e.Level == level && (e.Mismatch || (level == trace.SER && e.abortsDiffer())) {
			out = append(out, e)
		}
	}
	return out
}

// ScheduleText renders a case's schedule as .azs source.
func ScheduleText(sc *dsl.Scenario) string { return dsl.Format(sc) }

// SortEvals orders evaluations by case then level (stable output).
func SortEvals(evals []*Eval) {
	sort.SliceStable(evals, func(i, j int) bool {
		if evals[i].Case != evals[j].Case {
			return evals[i].Case < evals[j].Case
		}
		return evals[i].Level < evals[j].Level
	})
}

// RUProbe records what PostgreSQL does when asked for READ UNCOMMITTED, which
// is not compared with the engine (spec §9.4) but backs the one sentence the
// site says about it.
type RUProbe struct {
	Scenario           string `json:"scenario"`
	Requested          string `json:"requested"`
	EngineRU           string `json:"engineRU"`          // the engine's invariant outcome at RU
	PostgresInvariant  string `json:"postgresInvariant"` // "holds" means no dirty read happened
	DirtyReadObserved  bool   `json:"dirtyReadObserved"`
	SameAsReadCommited bool   `json:"sameHistoryAsReadCommitted"`
}

// ProbeReadUncommitted runs sc (the dirty-read scenario) with READ UNCOMMITTED
// and with READ COMMITTED and compares the two PostgreSQL histories.
func ProbeReadUncommitted(ctx context.Context, dsn string, sc *dsl.Scenario) (*RUProbe, error) {
	r, err := NewRunner(ctx, dsn, "az_ru")
	if err != nil {
		return nil, err
	}
	defer r.Close(ctx)
	ru, err := r.RunIsolation(ctx, sc, trace.RU, "READ UNCOMMITTED")
	if err != nil {
		return nil, err
	}
	rc, err := r.Run(ctx, sc, trace.RC)
	if err != nil {
		return nil, err
	}
	engHist, tr, err := RunEngine(sc, trace.RU)
	if err != nil {
		return nil, err
	}
	_ = engHist
	cell := PGCell(sc, ru, false)
	return &RUProbe{
		Scenario: sc.ID, Requested: "READ UNCOMMITTED",
		EngineRU:           cellOfTrace(tr).Invariant,
		PostgresInvariant:  cell.Invariant,
		DirtyReadObserved:  cell.Invariant == "violated",
		SameAsReadCommited: Fingerprint(ru) == Fingerprint(rc),
	}, nil
}

// RandomCasesAt builds the cases for specific seeds (investigations).
func RandomCasesAt(seeds []uint64) []Case {
	out := make([]Case, len(seeds))
	for i, seed := range seeds {
		out[i] = Case{Name: fmt.Sprintf("seed-%d", seed), SC: gen.Generate(seed, gen.Config{NoDelete: true})}
	}
	return out
}
