# Methodology: comparing the engine with PostgreSQL

Spec §9.4. This document says exactly how the comparison is made, how mismatches are classified, and documents every divergence the comparison found. Everything quantitative lives in `web/public/conformance.json` (written by the harness) and is rendered on the About page; this file does not repeat numbers that the report holds, except in the "Results of the accepted run" section, which is a dated copy.

## What is compared

| Engine level | PostgreSQL isolation level | Compared |
|---|---|---|
| RC | `READ COMMITTED` | per-statement results, final state, set of aborted transactions: **identical** |
| SI | `REPEATABLE READ` | same as RC |
| SER | `SERIALIZABLE` | both histories serializable per the oracle; abort-set statistics (below) |
| RU | none | not compared. A probe asks PostgreSQL for `READ UNCOMMITTED` on the dirty-read schedule and records whether a dirty read happened and whether the history equals the `READ COMMITTED` one |

A deadlock schedule (either side has a deadlock victim) is compared by **outcome class only**: both sides must have a deadlock victim; the victim may differ.

## How a schedule is executed on PostgreSQL

`conformance/pgrun.go`. One table per worker, `kv(k text COLLATE "C" primary key, v bigint not null)`, truncated before every run; the setup block is committed first, one row at a time, with the same upsert the schedule uses.

| DSL | SQL |
|---|---|
| `BEGIN` | `BEGIN ISOLATION LEVEL <level>`, then `SET LOCAL lock_timeout='5s'`; the connection had `SET deadlock_timeout='100ms'` |
| `READ k` | `SELECT v FROM kv WHERE k = $1` |
| `SCAN p [WHERE op n]` | `SELECT k, v FROM kv WHERE starts_with(k, $1) [AND v op $2] ORDER BY k` |
| `PUT k = e` | `INSERT INTO kv(k,v) VALUES($1,$2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`; `e` is evaluated by the engine's own expression evaluator on the values PostgreSQL returned |
| `DELETE k` | `DELETE FROM kv WHERE k = $1` (not used in the P8 corpus) |
| `COMMIT` / `ABORT` | `COMMIT` / `ROLLBACK` |

One connection per transaction, each statement run in its own goroutine, driven by a single orchestrator that walks the schedule in order.

**Blocked statements.** A statement still running after 200 ms **and** whose backend has `pg_stat_activity.wait_event_type = 'Lock'` is *blocked*. The orchestrator then continues with the schedule; later steps of a blocked transaction are queued (as in the engine). After every commit, abort or error the orchestrator waits (up to 2 s) for the statements it unblocked, and counts a still-blocked statement as stable only after it has kept waiting on a lock for 60 ms past the last release (these two constants, 60 ms and a 5 ms poll, are mine; the spec gives the other two). A statement that is neither finished nor lock-waiting after 10 s is cancelled and recorded as an anomaly. At the end of the schedule anything still blocked is cancelled with `pg_cancel_backend` (the engine's `blocked_at_end`).

**Errors.** SQLSTATE `40001` is a serialization abort, `40P01` a deadlock. After any error the orchestrator issues `ROLLBACK`, marks the transaction aborted and skips its remaining steps (the engine's rule). Any other SQLSTATE is an *anomaly* and always counts as a mismatch.

**Parallelism.** `-workers N` runs N independent runners, each with its own schema (`az_w0` ...), so schedules do not touch each other. CI uses 4 workers and the nightly run 6.

## Corpus

1. The 8 canned scenarios (`scenarios/*.azs`) at RC, SI and SER.
2. 500 random schedules per level from `gen.Generate(seed, Config{NoDelete: true})` with seeds `8000000 ... 8000499` (the same schedules at each level). The nightly run uses the first 10,000 seeds from the same base, so the 500-schedule corpus is its prefix.

`NoDelete` turns the generator's DELETE draws into READs. It is a generator option added for P8 (a separate commit); with it off the generator produces what it always did, which the random-digest fixture proves.

## Flake control

Every mismatch is re-run against PostgreSQL before it is classified: 5 times, or 30 times when two statements were blocked at the same time (see below), because PostgreSQL itself varies there and more runs are needed to see which outcomes it produces. Schedules in which two statements were blocked at once are re-run (5 times) even when the first run agreed with the engine, to measure that variation.

A mismatch whose re-runs disagree with each other and which had **no** simultaneous blocking would be a harness timing problem, and the harness exits non-zero for it. The harness also measures itself: every canned scenario at every level is run 5 times (10 in the nightly run) and the number of cases whose PostgreSQL history was not identical every time is reported as `stabilityUnstable` of `stabilityPairs`.

## Classifying a mismatch

Every mismatch ends up as exactly one of:

* **(a) an engine bug**: fixed in a separate commit, with the full gates (matrix, goldens with a reviewed diff, P1-P8 property tests, mutation checks, native-vs-WASM digests). A fix that would change a canned outcome stops the work for a report first.
* **(b) a harness bug**: fixed in `conformance/`. Found so far: the scripted `ABORT` was compared as "aborted" on the engine side and "ok" on PostgreSQL's (the engine reports a user abort as an event with status `aborted` and reason `abort_user`).
* **(c) a documented difference** between the teaching engine and PostgreSQL, listed under "Divergences" with a plain-English cause and a minimal schedule committed under `engine/testdata/regressions/`.

A cause that has not been established is written as exactly `cause not yet established`. `TestDivergencesWellFormed` enforces that wording and `TestRegressionsReproduce` re-runs each regression schedule 40 times on PostgreSQL and fails if PostgreSQL ever stops differing from the engine on it.

### Matching random mismatches to divergences

A random mismatch is *explained* when its signature matches a divergence in `conformance/divergences.json`. The signature is the level, whether two statements were blocked at the same time (`race/varies` when PostgreSQL's own history varied between runs, `race/fixed` when it did not) and the kinds of difference seen. It is deliberately coarse, so it can absorb a real bug that happens to occur in a schedule with simultaneous blocking. Two things bound that risk and are reported: among schedules **without** simultaneous blocking the result must be 100 % identical at RC and SI (the report prints that number per level), and `unexplained` must stay 0.

## SER statistics

For each random schedule at SER, with `E` the engine's set of aborted transactions and `P` PostgreSQL's (scripted `ABORT`s excluded):

* both histories serializable per the oracle: must be 100 % for both;
* identical abort sets: `E == P`;
* the engine aborts more: `|E| > |P|`; fewer: `|E| < |P|`; different sets of the same size: reported separately.

Every "fewer" case must still be serializable (`engineAbortsFewerNotSerializable` must be 0).

## What the first runs found, and the experiments behind each conclusion

All experiments below were run against PostgreSQL 16.15 on the development machine (Windows 11, a portable build of PostgreSQL), using the harness itself (`azoo-conformance -debug <schedule> -level <L> -n <runs>`). Counts are runs of one schedule.

1. **Harness bug: scripted ABORT.** The first canned run showed `dirty-read` mismatching at all three levels, always `T1 ABORT: engine=aborted postgres=ok`. The engine reports a user `ABORT` as an event with status `aborted` and reason `abort_user`; the harness read that as a system abort. Fixed in `FromTrace`. The engine was not touched.
2. **PostgreSQL's own result varies when two statements are blocked at once.** Minimal schedule (`wake-order-race.azs`): T1 writes `x`, T2 and T3 both write `x` and wait, T1 commits, T2 commits, T3 commits. The engine's answer is fixed (`x=3`, arrival order). PostgreSQL gave `x=2` in 33 of 100 runs and `x=3` in 67 when `x` was absent, and `x=2` in 25 of 100 when `x` was already in the table. The same schedule with only **one** waiter (`T3` writing a different key) gave the engine's history in 100 of 100 runs at each of RC, SI and SER, with `x` absent and with `x` present.
3. **Transaction id order skews that choice but does not decide it.** With a write added at the start so that T1, T2 or T3 holds the lowest transaction id, the split stayed near half and half (54/46, 44/56 and 66/34 in 100 runs each). In a schedule where the transaction that holds the contested key **aborts** (instead of committing) and two others then race to insert it, the one with the lower transaction id won 40 of 40 runs, and when the other one had the lower id the outcome varied (26 / 12 / 2 of 40). No rule is claimed from this.
4. **Autovacuum changed PostgreSQL's Serializable answers.** With autovacuum enabled on the harness tables, one Serializable schedule produced a different PostgreSQL history in 6 of 900 runs; with `autovacuum_enabled = false` on the tables, in 0 of 1,200 runs (three series of 400). Background vacuum and analyze are not what is being compared, so the harness disables them on its tables (the switch `AZOO_AUTOVACUUM=1` turns it back on for this measurement). This was the only instability found in a schedule without simultaneous blocking.
5. **PostgreSQL's Serializable read locks are per index page.** `TestSIReadLockGranularity` reads `pg_locks` after a one-key read and after a prefix scan: in both cases the backend holds a page-level `SIReadLock` on the key index (`page(kv_pkey)`) besides tuple locks. (My first expectation, a relation-level lock for the scan, was wrong and is not claimed.)
6. **Control experiment for the page-lock explanation.** `TestPageGranularityControl` runs `ser-disjoint-keys.azs` and `ser-different-victim.azs` on PostgreSQL with and without 3,000 filler rows after every key the schedule uses (so the keys cannot share an index page; filler rows are left out of the final state and never inside a scanned prefix). Without filler PostgreSQL differs from the engine in 10 of 10 runs; with it, in 0 of 10. The third SER schedule scans the prefixes where filler would have to go, so the control cannot be run on it.

## Divergences

Listed in `conformance/divergences.json` (the source) and rendered on the About page. Each has a minimal schedule under `engine/testdata/regressions/`, re-run 25 times on PostgreSQL by `TestRegressionsReproduce`.

| id | levels (smallest schedule) | what differs | cause |
|---|---|---|---|
| `wake-order-race` | RC | PostgreSQL's result varies from run to run; the engine's is fixed | The engine serves waiters in arrival order and runs each woken transaction's queued statements before waking the next. PostgreSQL does neither (experiments 2 and 3). Established. |
| `released-waiters-interleave` | RC, SI, SER | PostgreSQL gives a contested key to a different waiter than the engine, in every run | **cause not yet established.** The engine side is known (above); why PostgreSQL's order is fixed here but varies in `wake-order-race` is not. |
| `ser-disjoint-keys` | SER | PostgreSQL aborts a transaction that shares no key with the others; the engine commits both | Page-level read locks (experiments 5 and 6). Established for the smallest schedule; other random schedules in this class are classified by abort reason and the serializability check, not reduced one by one. |
| `ser-different-victim` | SER | Same number of aborts, different transaction | Same cause; the control experiment passes. Established. |
| `ser-abort-earlier-statement` | SER | Same transaction aborted, one statement earlier in PostgreSQL | **cause not yet established.** It may be the same page-level locks, but the control cannot be run on this schedule. |

The "engine aborts more than PostgreSQL" bucket (SER) contained, in the accepted run, only schedules with simultaneous blocking, where the cause is the wake-order difference above; none arose without it. If a future run (the nightly one) produces such a case without simultaneous blocking it appears as `unexplained` and the harness fails: it would need its own entry or an engine fix.
