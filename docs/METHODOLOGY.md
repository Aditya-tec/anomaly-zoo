# Methodology

How Anomaly Zoo works, how it is checked, and exactly where it differs from PostgreSQL. Everything quantitative is a recorded number: the PostgreSQL comparison lives in `web/public/conformance.json` (written by the harness, rendered on the About page) and the test runs are logged in `docs/PROGRESS.md`. This file explains the method and does not invent figures; where it quotes one it names the source.

Contents: [Engine semantics](#engine-semantics-summary) · [Oracle](#the-serializability-oracle) · [Property tests](#property-tests) · [Mutation checks](#mutation-checks) · [Golden traces and the matrix](#golden-traces-and-the-matrix) · [Conformance against PostgreSQL](#conformance-against-postgresql) (the sections from "What is compared" down to "Divergences") · [Limits](#limits)

## Engine semantics (summary)

The engine is a deterministic, single-threaded simulation of a multi-version key-to-integer store, written in Go with only the standard library. A *schedule* is a script of steps (`BEGIN`, `READ`, `SCAN`, `PUT`, `DELETE`, `COMMIT`, `ABORT`, `NOTE`) by up to six transactions; the runner processes the steps in order and records one event per step in a trace. The full contract is `spec.md` section 4; the short version:

* **Versions.** Every key has a chain of versions, each stamped with its writer and a commit timestamp (0 while uncommitted). A logical clock advances by one at each commit. A transaction always sees its own uncommitted writes.
* **What a read sees.** *Read Uncommitted*: the newest version, including other transactions' uncommitted writes. *Read Committed*: the newest committed version as of the start of the statement. *Snapshot Isolation*: the newest version committed at or before the transaction's snapshot, which is taken at its first data operation (not at `BEGIN`). *Serializable* reads the same snapshot.
* **Writes.** Every `PUT` and `DELETE` takes the key's write lock, including for keys that do not exist yet; reads never block. A statement that cannot get the lock is *blocked*, the schedule continues, and later steps of that transaction queue behind it. When the holder commits or aborts, blocked statements are retried in first-in-first-out order.
* **First-updater-wins** (Snapshot Isolation and Serializable): a writer that gets a lock on a key whose newest committed version is newer than its snapshot is aborted (`abort_concurrent_update`). Read Committed has no such check, which is what allows lost updates there.
* **Deadlocks.** When a blocked statement closes a wait-for cycle, the transaction that issued it is aborted (`abort_deadlock`). PostgreSQL's victim can differ, so the comparison uses the outcome class only for deadlock schedules.
* **Serializable** is "SSI-lite", after the algorithm of Cahill, Röhm and Fekete as implemented in PostgreSQL by Ports and Grittner: it records read-write dependencies between concurrent transactions (key and key-prefix read locks), and aborts a transaction that becomes the pivot of a dangerous structure (`abort_dependencies`) at the statement that completes it, at commit, or at its next operation if it was only marked doomed. Simplifications: predicate locks are key-prefix only, there is no read-only optimisation, nothing is summarised or evicted.
* **Determinism.** The same schedule always produces the same trace byte for byte; the trace carries a SHA-256 digest of its canonical JSON. The WebAssembly build produces the same digests as the native build (checked on all 32 canned traces and on random schedules, under Node).

## The serializability oracle

`engine/oracle` decides whether the committed transactions of a run are equivalent to *some* serial order. Given the setup state, each committed transaction's statements with the results they actually observed, and the final state, it tries every permutation of the committed transactions: it replays them one at a time on a fresh store, each atomically, and accepts an order only if every `READ` and `SCAN` returns exactly what was observed and the final state equals the observed final state. The verdict and the first accepting order are written into every trace. The oracle is checked by its own unit tests (write skew, the read-only anomaly and a lost update are rejected; serial, empty and delete/absent histories are accepted). It also includes a shrinker that deletes steps, transactions and keys from a failing schedule while the failure persists and prints the minimal `.azs`. The oracle is also what the conformance harness uses on PostgreSQL's histories.

The oracle checks equivalence to a serial order on observed results; it is not a proof that the engine's Serializable level is correct, and the project does not claim that. What is claimed is the number of random schedules the engine's histories were checked on and how many the oracle rejected (see Property tests).

## Property tests

`engine/run` generates random schedules deterministically from a seed (a splitmix64 generator written in the repository so results do not depend on a Go release): 2 to 4 transactions, 3 to 8 operations each over the keys `p:1 p:2 p:3 q:1 q:2`, with prefix scans, about 5 % DELETEs, 20 % of transactions ending in `ABORT`, and a random interleaving. At each level the tests assert, on every schedule:

| | Levels | Property |
|---|---|---|
| P1 | all | terminates, the trace validates against the JSON Schema, the digest is stable across two runs |
| P2 | all | store invariants: chains ordered, at most one uncommitted version per key and it is last, none left at the end, locks empty at the end, clock equals commits plus one |
| P3 | RC, SI, SER | no dirty reads |
| P4 | SI, SER | repeatable reads (the same key or scan, read twice with no own write between, returns the same) |
| P5 | SI, SER | no lost updates (no two concurrent committed transactions write the same key) |
| P6 | SER | the oracle accepts every history of committed transactions |
| P7 | SI, RC | vacuity guards: Snapshot Isolation does produce non-serializable histories and Read Committed does produce non-repeatable reads, otherwise the generator or the oracle would be broken |
| P8 | all | native and WebAssembly digests agree |

The default test run uses 20,000 schedules per level; a one-off local run used 200,000 Serializable schedules (seeds 1,000,000 to 1,199,999) with 0 oracle rejections (`docs/PROGRESS.md`, AC4.2). The `fuzz` workflow can repeat the 200,000-schedule campaign for every level; that run has not been done. A failing schedule is shrunk and saved under `engine/testdata/regressions/` and kept.

## Mutation checks

A passing test suite proves little if it could not fail, so `engine/ssi` has five switches (`ssi.Faults`), one per SSI rule: the three edge-creation rules, the commit-time check and the after-commit re-check. `TestMutationChecks` turns each off in turn and requires a test to fail. Disabling any of the three edge rules is caught by random or canned schedules and shrinks to an 8-step counterexample. Disabling the commit-time check or the after-commit re-check is *not* caught by random schedules: 200,000-schedule campaigns with each one switched off found 0 non-serializable histories (`docs/PROGRESS.md`, P4 follow-ups), which is evidence that those two rules are redundant for serializability in this model, not proof. They are kept as defence in depth, and targeted tests fail when either is removed.

## Golden traces and the matrix

The eight canned scenarios at four levels give 32 traces; they are stored byte for byte in `engine/testdata/golden/` and updated only with an explicit `-update` flag and a reviewed diff. `azoo matrix --check` recomputes the anomaly-by-level matrix by running the engine and compares it with `scenarios/expected.json` (outcome, serializability verdict, aborted transactions and mechanism). The website builds its map from these traces and never contains a hand-written outcome: a lint rule bans the outcome words outside one module, and tests build the map from fixture traces.

## Conformance against PostgreSQL

The remaining sections down to "Divergences" describe the PostgreSQL comparison (spec section 9.4): what is compared, how a schedule is executed, flake control, classification, the experiments behind each conclusion, and the divergences, two of which are recorded as "cause not yet established".

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

## Limits

These are the limits stated on the About page, with what backs the PostgreSQL clauses.

1. **A key-to-integer model with prefix scans.** There is no SQL, no indexes, no durability and no query planner.
2. **A deterministic, single-threaded simulation of interleavings, not real concurrency.** A schedule is a fixed script. This is the root of the first PostgreSQL divergence above: when one commit or abort releases several waiting transactions at once, PostgreSQL lets them run concurrently and the engine serves them one after another in arrival order.
3. **Read Uncommitted is included to show dirty reads.** PostgreSQL has no read-uncommitted: when asked for `READ UNCOMMITTED` on the dirty-read schedule it showed no dirty read and produced the same history as `READ COMMITTED` (the probe in `conformance.json`, `readUncommitted`).
4. **The Serializable level is simplified.** Its predicate locks are key-prefix only and it has no read-only optimisation. The comparison quantifies how its aborts differ from PostgreSQL's: PostgreSQL's own read locks are per index page, so on the compared schedules it aborted transactions the engine did not far more often than the reverse (counts in `conformance.json`, `random.SER`; causes in "Divergences").
5. **Vendor behaviours differ.** This explains concepts and does not replace your database's documentation. Only PostgreSQL 16 was compared, at three of its isolation levels, on schedules without `DELETE`.

What the numbers do not show: they are counts over generated schedules with two to four transactions and five keys, not a guarantee about any other workload. Passing an oracle on random schedules is evidence, not a proof of correctness.
