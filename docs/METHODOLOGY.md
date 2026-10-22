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

The remaining sections down to "Divergences" describe the PostgreSQL comparison (spec section 9.4): what is compared, how a schedule is executed, flake control, classification, the experiments behind each conclusion, and the divergences (eight, three of which are recorded as "cause not yet established").

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


**Hints (Serializable, the engine aborts more, no waiters raced).** A shape alone cannot tell causes apart here, so for this one kind the harness runs the control experiments of experiment 9 (`conformance/classify.go`) on the shrunk schedule and puts the first hint that applies into the signature: `hint/page-locks`, `hint/no-writes-in-edge`, `hint/error-deferred-to-commit`, or `hint/in-transaction-rolled-back` (structural: every engine-only abort is a pivot, re-derived from the trace, whose in-edge transaction ends by its own rollback; no PostgreSQL experiment backs this one, which is why its divergence says "cause not yet established"). A mismatch of this kind with **no** hint matches no divergence, is reported as unexplained and fails the run. The CI and nightly jobs print every unexplained mismatch, with its hints, both abort sets, PostgreSQL's reason text and its minimal schedule, in the job summary (`-summary "$GITHUB_STEP_SUMMARY"`), so nobody has to read raw logs.

Two limits of this classification are worth stating. The hints are computed from a handful of PostgreSQL runs on a shrunk schedule, so a mismatch can occasionally be hinted wrongly or not at all (the latter fails loudly, the former does not). And a hint says which control moves PostgreSQL's answer, not why: only the divergences marked established have an explanation that a control experiment supports.

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
7. **The first 10,000-schedule nightly run found a kind the 500-schedule corpus had not** (GitHub Actions run 39724497391, seeds 8000000 to 8009999, no DELETE). Read Committed (424 mismatches) and Snapshot Isolation (117) were fully explained. Serializable had 953 mismatches, 932 explained and **21 not**. All 21 are "the engine aborts more than PostgreSQL" with no two statements blocked at once; both sides' histories were serializable in 10,000 of 10,000 and there were 0 "fewer but not serializable". In total 63 schedules were of the "engine aborts more" kind, 42 of them with simultaneous blocking (covered by the first two divergences) and these 21 without. Per-seed record: `docs/NIGHTLY-1-SER-ANALYSIS.md`.
8. **Engine first: are the 21 engine aborts consistent with the engine's own rules?** `azoo-conformance -verify seed-N` recomputes spec 4.8 (rw-edges, dangerous structure, victim) and 4.6 (first-updater-wins) from the edges and commits recorded in the engine's trace, with code that does not share the engine's logic. Result over the 21 schedules: 46 engine aborts, **46 PASS, 0 FAIL**. Four were also derived by hand from the shrunk schedules:
    * *8005774.* T2 reads, T3 writes p:2, T1 reads p:2 and scans: edges T2 to T1 (T1 wrote q:1 which T2 had read, rule 3), T1 to T3 (T1 cannot see T3's uncommitted write, rule 1) and T2 to T3 (rule 2). T3 commits first, so T1 is a pivot (in-edge from T2, out-edge to T3, T3 committed before both); the victim is the active pivot T1, doomed when T3 commits and aborted at its next statement. As the spec says. T1 then rolls back by its script.
    * *8007195.* T2 scans `q:` and writes p:1; T1 reads p:1 (cannot see T2's uncommitted write: T1 to T2) and writes q:2 (inside T2's scanned prefix: T2 to T1). T1 commits first: T2 is the pivot (in and out edges both with T1), the victim, doomed and aborted at its next statement.
    * *8007073.* T1 reads p:3, which T3 then writes and commits (T1 to T3); T2 only reads, and T1 later writes q:1 inside the prefix T2 scanned (T2 to T1; T2 is concurrent because it committed after T1's snapshot). T3 committed (timestamp 2) before T2 (3), T1 is active: pivot T1, aborted at the write that completes the structure.
    * *8006497.* T2 scans `p:` and T3 then writes p:2 (T2 to T3); T1 scans `p:` and sees neither uncommitted write (T1 to T2, T1 to T3). T3 commits first: T2 is the pivot (in-edge from T1, out-edge to T3), doomed when T3 commits and aborted at its own commit.

    No engine abort contradicts the documented rules, so nothing in the engine, `expected.json` or the golden traces was changed.
9. **Control experiments on the 21 shrunk schedules.** Each control changes one thing in the schedule and asks whether PostgreSQL then agrees with the engine (padding) or aborts the transaction the engine aborts (the other two). Results by the first control that applies:
    * **Padding** (3,000 filler rows after every key the schedule uses, never inside a scanned prefix): PostgreSQL agrees with the engine in 10 of 10 runs padded and differs in 10 of 10 unpadded, for 7 seeds (8001768, 8006837, 8006904, 8007066, 8007459, 8008512, 8008535). These are the page-level read locks of experiments 5 and 6. In 8007459 PostgreSQL aborts T1 at commit, so T1's write never becomes committed there, and the engine's later first-updater aborts of T3 and T4 have no counterpart.
    * **A write added to the transaction that writes nothing** (one harmless write to a key nothing else touches, inserted immediately before its first read, so its snapshot moment is unchanged): 8007073 (T2) and 8007240 (T4), PostgreSQL then differs in 0 of 8 runs (8003201 responds as well, see its entry).
    * **The scripted ABORT turned into a COMMIT** for the transaction the engine aborts: for 8003734, 8005774, 8007195 and 8007742 PostgreSQL then aborts the *same* transaction as the engine, at the commit instead of at the next statement.
    * **None of these** for 8002470, 8004074, 8006497, 8007083, 8008159 and 8008548: in each, the engine's extra abort is a pivot whose in-edge transaction later rolls back by its script. In the smallest case (8006497) PostgreSQL lets the pivot commit and nobody is aborted; with the in-edge transaction's rollback turned into a commit, PostgreSQL aborts *that* transaction, not the pivot. The cause of PostgreSQL's behaviour here is **not established**; no mechanism is claimed.
10. **Why the controls run on the minimal schedule.** On the full schedules padding has nowhere to put filler rows (the scans cover both key prefixes) and several causes can stack up, so one control rarely makes PostgreSQL agree completely. The harness therefore shrinks each such mismatch first (3 PostgreSQL runs per candidate must show the same kind of difference, at most 400 candidates), then runs the controls on the shrunk schedule. Seed 8006904 is an example of why this is evidence and not proof: its shrunk schedule differed 5 of 5 times when it was found but 0 of 8 times in a later control run, so the shrunk schedule for that seed is not stable; its classification (page locks) comes from the harness's own run on the full seed, where padding made PostgreSQL abort an engine-only abort in every run.

## Divergences

Listed in `conformance/divergences.json` (the source) and rendered on the About page. Each has a minimal schedule under `engine/testdata/regressions/`, re-run 25 times on PostgreSQL by `TestRegressionsReproduce`.

| id | levels (smallest schedule) | what differs | cause |
|---|---|---|---|
| `wake-order-race` | RC | PostgreSQL's result varies from run to run; the engine's is fixed | The engine serves waiters in arrival order and runs each woken transaction's queued statements before waking the next. PostgreSQL does neither (experiments 2 and 3). Established. |
| `released-waiters-interleave` | RC, SI, SER | PostgreSQL gives a contested key to a different waiter than the engine, in every run | **cause not yet established.** The engine side is known (above); why PostgreSQL's order is fixed here but varies in `wake-order-race` is not. |
| `ser-disjoint-keys` | SER | PostgreSQL aborts a transaction that shares no key with the others; the engine commits both | Page-level read locks (experiments 5 and 6). Established for the smallest schedule; other random schedules in this class are classified by abort reason and the serializability check, not reduced one by one. |
| `ser-different-victim` | SER | Same number of aborts, different transaction; also seen as the engine aborting more | Same cause; the control experiment passes. In 7 of the 21 seeds of the first nightly run PostgreSQL aborts a different transaction, so what commits differs and the engine's later first-updater aborts have no counterpart; padding makes PostgreSQL agree. Established. |
| `ser-abort-earlier-statement` | SER | Same transaction aborted, one statement earlier in PostgreSQL | **cause not yet established.** It may be the same page-level locks, but the control cannot be run on this schedule. |
| `ser-no-writes-in-edge` | SER | PostgreSQL aborts nobody when the transaction at the start of the dependency wrote nothing; the engine aborts the middle one | In the smallest schedule the first transaction only reads; one harmless write added to it makes PostgreSQL abort the same transaction as the engine (control, `TestSERControls`). The engine has no read-only optimisation (spec 4.8). Established as an observation; no mechanism is named. Found by the 10,000-schedule run. |
| `ser-error-deferred-to-commit` | SER | The engine aborts a doomed transaction at its next statement; PostgreSQL raises no error before the transaction rolls back by itself | With the rollback turned into a commit PostgreSQL aborts the same transaction, at the commit (control, `TestSERControls`). Established. Found by the 10,000-schedule run. |
| `ser-pivot-before-in-ends` | SER | The engine aborts the middle transaction of a dependency chain as soon as the last one commits; PostgreSQL aborts nobody when the first one then rolls back | **cause not yet established.** The engine follows spec 4.8 (re-derived). With the first transaction's rollback turned into a commit PostgreSQL aborts that transaction, not the middle one. Found by the 10,000-schedule run. |

The "engine aborts more than PostgreSQL" bucket (SER) contained, in the 500-schedule corpus, only schedules with simultaneous blocking, where the cause is the wake-order difference above. The first 10,000-schedule run produced the case this document said would need its own entry: 21 schedules of that kind without simultaneous blocking (experiments 7 to 10, `docs/NIGHTLY-1-SER-ANALYSIS.md`), now covered by `ser-different-victim`, `ser-no-writes-in-edge`, `ser-error-deferred-to-commit` and `ser-pivot-before-in-ends`. The rule stays: a case of this kind without a hint is unexplained and fails the harness.

## Limits

These are the limits stated on the About page, with what backs the PostgreSQL clauses.

1. **A key-to-integer model with prefix scans.** There is no SQL, no indexes, no durability and no query planner.
2. **A deterministic, single-threaded simulation of interleavings, not real concurrency.** A schedule is a fixed script. This is the root of the first PostgreSQL divergence above: when one commit or abort releases several waiting transactions at once, PostgreSQL lets them run concurrently and the engine serves them one after another in arrival order.
3. **Read Uncommitted is included to show dirty reads.** PostgreSQL has no read-uncommitted: when asked for `READ UNCOMMITTED` on the dirty-read schedule it showed no dirty read and produced the same history as `READ COMMITTED` (the probe in `conformance.json`, `readUncommitted`).
4. **The Serializable level is simplified.** Its predicate locks are key-prefix only and it has no read-only optimisation. The comparison quantifies how its aborts differ from PostgreSQL's: PostgreSQL's own read locks are per index page, so on the compared schedules it aborted transactions the engine did not far more often than the reverse (counts in `conformance.json`, `random.SER`; causes in "Divergences").
5. **Vendor behaviours differ.** This explains concepts and does not replace your database's documentation. Only PostgreSQL 16 was compared, at three of its isolation levels, on schedules without `DELETE`.

What the numbers do not show: they are counts over generated schedules with two to four transactions and five keys, not a guarantee about any other workload. Passing an oracle on random schedules is evidence, not a proof of correctness.
