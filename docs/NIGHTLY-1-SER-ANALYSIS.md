# Nightly run 1 (run 39724497391): the 21 unexplained Serializable mismatches

Written 2026-10-22. The 10,000-schedule nightly run had RC and SI fully explained and 21 of 953 Serializable mismatches unexplained; both sides' histories were serializable in 10,000 of 10,000 and 0 "fewer but not serializable". All 21 are the same kind: **the engine aborts more transactions than PostgreSQL**, in schedules where no two statements were blocked at once. This file is the per-seed record. Method and the divergences it led to: `docs/METHODOLOGY.md`.

## Summary

* **No engine bug.** For every engine abort in these 21 schedules (46 dependency aborts and first-updater aborts) the dangerous structure (spec 4.8: edges, pivot, victim) or the first-updater condition (spec 4.6) was re-derived from the edges and commits recorded in the engine's own trace by code that does not share the engine's logic: **46 PASS, 0 FAIL** (`go run ./cmd/azoo-conformance -verify seed-N`). A few were also checked by hand (seeds 8005774, 8007195, 8007073, 8006497; the derivations are written out in METHODOLOGY). The engine committed no non-serializable history (oracle: 10,000 of 10,000). `expected.json`, the golden traces and the engine were not touched.
* **All 21 reproduce:** in every case 5 of 5 re-runs on PostgreSQL again differed from the engine (local PostgreSQL 16.15; the nightly run itself also found them reproducing).
* **Classification** (by the control that moves PostgreSQL's answer on the minimal schedule):
  * 7 seeds: PostgreSQL's page-level read locks (padding the keys onto different index pages makes PostgreSQL agree): 8001768, 8006837, 8006904, 8007066, 8007459, 8008512, 8008535. Existing divergence `ser-different-victim`.
  * 2 seeds: a transaction that writes nothing (adding one write makes PostgreSQL agree): 8007073, 8007240. New divergence `ser-no-writes-in-edge`. (8003201 also responds to this control; see its entry.)
  * 4 seeds: the error is raised at commit, not at the next statement (turning the transaction's scripted ABORT into a COMMIT makes PostgreSQL abort the same transaction): 8003734, 8005774, 8007195, 8007742. New divergence `ser-error-deferred-to-commit`.
  * 6 seeds: the engine aborts a pivot whose in-edge transaction later rolls back; PostgreSQL aborts nobody. No control explains PostgreSQL's side: 8002470, 8004074, 8006497, 8007083, 8008159, 8008548. New divergence `ser-pivot-before-in-ends`, **cause not yet established**.
  * 2 seeds were a different kind on the local PostgreSQL than on the nightly runner (not "engine aborts more" here): 8003140 and 8003201. They match the older divergences by shape locally; see their entries.

Columns below: the statement at which each side aborts (step number is the position in the full schedule), PostgreSQL's reason text where it aborts, and the minimal schedule found by the shrinker (3 PostgreSQL runs per candidate must all show the same kind of difference).

## seed-8001768

* Classified as: **ser-different-victim (page-level read locks; padding control)** (hints: page-locks, in-transaction-rolled-back)
* engine aborts: T1 at step 16 (SCAN)  T4 at step 17 (READ)  T2 at step 18 (READ) 
* PostgreSQL aborts: T4 at step 17 (READ)  T2 at step 18 (READ)
* PostgreSQL's reason text:
  * PostgreSQL: T2: 40001 could not serialize access due to read/write dependencies among transactions | Reason code: Canceled on identification as a pivot, during conflict out checking.
  * PostgreSQL: T4: 40001 could not serialize access due to read/write dependencies among transactions | Reason code: Canceled on identification as a pivot, during conflict out checking.
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T3 COMMIT step 15: PASS dependency abort of T2: pivot T2 (in-edge from T3, out-edge to T3, T3 committed first at ts 2)
  * T1 SCAN step 16: PASS dependency abort of T1: pivot T1 (in-edge from T4, out-edge to T3, T3 committed first at ts 2)
  * T4 READ step 17: PASS dependency abort of T4: pivot T4 (in-edge from T2, out-edge to T3, T3 committed first at ts 2)
* Page-granularity control on the minimal schedule (10 runs each): steps=14 unpadded: DIFF 10 | padded: MATCH 10 
* Other controls on the minimal schedule (8 runs each):
  * 8001768 baseline: PG differs 8 of 8 runs (E aborts [T1:serialization])
  * 8001768 ro-write T2: PG differs 8 of 8 runs (E aborts [T1:serialization])
  * 8001768 abort->commit T1: PG differs 8 of 8 runs (E aborts [T1:serialization])
  * 8001768 abort->commit T4: PG differs 8 of 8 runs (E aborts [T1:serialization])
  * 8001768 abort->commit T2: PG differs 8 of 8 runs (E aborts [T1:serialization])

Minimal schedule:

```
scenario gen-8001768
schedule:
  T4 BEGIN
  T4 READ p:1 AS v4_0
  T1 BEGIN
  T3 BEGIN
  T4 PUT q:2 = 34
  T2 BEGIN
  T1 PUT p:1 = 58
  T3 PUT p:2 = 18
  T3 COMMIT
  T2 READ q:2 AS v2_3
  T1 READ p:2 AS v1_4
  T2 ABORT
  T4 ABORT
  T1 ABORT
```

## seed-8003734

* Classified as: **ser-error-deferred-to-commit** (hints: error-deferred-to-commit)
* engine aborts: T1 at step 16 (READ)  T3 at step 21 (PUT) 
* PostgreSQL aborts: T3 at step 21 (PUT)
* PostgreSQL's reason text:
  * PostgreSQL: T3: 40001 could not serialize access due to concurrent update
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T2 COMMIT step 14: PASS dependency abort of T1: pivot T1 (in-edge from T3, out-edge to T2, T2 committed first at ts 2)
  * T3 PUT step 21: first-updater-wins abort of T3 (snapshot ts 1) on key q:2: newest committed version ts 2: PASS
* Page-granularity control on the minimal schedule (10 runs each): steps=9 unpadded: DIFF 10 | padded: DIFF 10 
* Other controls on the minimal schedule (8 runs each):
  * 8003734 baseline: PG differs 8 of 8 runs (E aborts [T1:serialization])
  * 8003734 abort->commit T1: PG differs 8 of 8 runs (E aborts [T1:serialization])

Minimal schedule:

```
scenario gen-8003734
schedule:
  T2 BEGIN
  T1 BEGIN
  T1 PUT q:1 = 48
  T2 PUT q:2 = 30
  T2 SCAN q: AS v2_2
  T1 READ q:2 AS v1_2
  T2 COMMIT
  T1 READ p:1 AS v1_4
  T1 ABORT
```

## seed-8005774

* Classified as: **ser-error-deferred-to-commit** (hints: error-deferred-to-commit, in-transaction-rolled-back)
* engine aborts: T1 at step 16 (READ) 
* PostgreSQL aborts: none
* PostgreSQL's reason text:
  * (PostgreSQL aborts none of these transactions)
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T3 COMMIT step 15: PASS dependency abort of T1: pivot T1 (in-edge from T2, out-edge to T3, T3 committed first at ts 2)
* Page-granularity control on the minimal schedule (10 runs each): steps=11 unpadded: DIFF 10 | padded: DIFF 10 
* Other controls on the minimal schedule (8 runs each):
  * 8005774 baseline: PG differs 8 of 8 runs (E aborts [T1:serialization])
  * 8005774 ro-write T2: PG differs 8 of 8 runs (E aborts [T1:serialization])
  * 8005774 abort->commit T2: PG differs 8 of 8 runs (E aborts [T1:serialization])
  * 8005774 abort->commit T1: PG differs 8 of 8 runs (E aborts [T1:serialization])

Minimal schedule:

```
scenario gen-8005774
schedule:
  T2 BEGIN
  T1 BEGIN
  T3 BEGIN
  T3 PUT p:2 = 1
  T1 PUT q:1 = 78
  T1 READ p:2 AS v1_4
  T2 SCAN q: AS v2_2
  T3 COMMIT
  T1 READ p:1 AS v1_5
  T1 ABORT
  T2 ABORT
```

## seed-8007195

* Classified as: **ser-error-deferred-to-commit** (hints: error-deferred-to-commit)
* engine aborts: T2 at step 14 (READ) 
* PostgreSQL aborts: none
* PostgreSQL's reason text:
  * (PostgreSQL aborts none of these transactions)
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T1 COMMIT step 13: PASS dependency abort of T2: pivot T2 (in-edge from T1, out-edge to T1, T1 committed first at ts 2)
* Page-granularity control on the minimal schedule (10 runs each): steps=9 unpadded: DIFF 10 | padded: DIFF 10 
* Other controls on the minimal schedule (8 runs each):
  * 8007195 baseline: PG differs 8 of 8 runs (E aborts [T2:serialization])
  * 8007195 abort->commit T2: PG differs 8 of 8 runs (E aborts [T2:serialization])

Minimal schedule:

```
scenario gen-8007195
schedule:
  T2 BEGIN
  T2 SCAN q: AS v2_0
  T2 PUT p:1 = 1
  T1 BEGIN
  T1 READ p:1 AS v1_2
  T1 PUT q:2 = 35
  T1 COMMIT
  T2 READ q:1 AS v2_3
  T2 ABORT
```

## seed-8007742

* Classified as: **ser-error-deferred-to-commit** (hints: error-deferred-to-commit)
* engine aborts: T3 at step 14 (PUT)  T4 at step 20 (READ)  T2 at step 21 (READ) 
* PostgreSQL aborts: T3 at step 14 (PUT)  T4 at step 20 (READ)
* PostgreSQL's reason text:
  * PostgreSQL: T3: 40001 could not serialize access due to read/write dependencies among transactions | Reason code: Canceled on identification as a pivot, during write.
  * PostgreSQL: T4: 40001 could not serialize access due to read/write dependencies among transactions | Reason code: Canceled on identification as a pivot, during conflict out checking.
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T1 COMMIT step 17: PASS dependency abort of T2: pivot T2 (in-edge from T1, out-edge to T1, T1 committed first at ts 2)
  * T1 COMMIT step 17: PASS dependency abort of T4: pivot T4 (in-edge from T1, out-edge to T1, T1 committed first at ts 2)
  * T3 PUT step 14: PASS dependency abort of T3: pivot T3 (in-edge from T1, out-edge to T1, T1 committed first at ts 2)
* Page-granularity control on the minimal schedule (10 runs each): steps=9 unpadded: DIFF 10 | padded: DIFF 10 
* Other controls on the minimal schedule (8 runs each):
  * 8007742 baseline: PG differs 8 of 8 runs (E aborts [T2:serialization])
  * 8007742 abort->commit T2: PG differs 8 of 8 runs (E aborts [T2:serialization])

Minimal schedule:

```
scenario gen-8007742
schedule:
  T2 BEGIN
  T1 BEGIN
  T2 PUT p:3 = 49
  T2 SCAN q: AS v2_2
  T1 SCAN p: AS v1_0
  T1 PUT q:1 = 16
  T1 COMMIT
  T2 READ q:2 AS v2_5
  T2 ABORT
```

## seed-8008159

* Classified as: **ser-pivot-before-in-ends (cause not yet established)** (hints: in-transaction-rolled-back)
* engine aborts: T4 at step 8 (PUT)  T1 at step 19 (PUT)  T2 at step 20 (COMMIT) 
* PostgreSQL aborts: T1 at step 19 (PUT)  T2 at step 20 (COMMIT)
* PostgreSQL's reason text:
  * PostgreSQL: T1: 40001 could not serialize access due to concurrent update
  * PostgreSQL: T2: 40001 could not serialize access due to read/write dependencies among transactions | Reason code: Canceled on identification as a pivot, during commit attempt.
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T3 COMMIT step 18: PASS dependency abort of T1: pivot T1 (in-edge from T4, out-edge to T3, T3 committed first at ts 2)
  * T3 COMMIT step 18: PASS dependency abort of T2: pivot T2 (in-edge from T1, out-edge to T3, T3 committed first at ts 2)
  * T4 PUT step 8: PASS dependency abort of T4: pivot T4 (in-edge from T2, out-edge to T3, T3 committed first at ts 2)
* Page-granularity control on the minimal schedule (10 runs each): steps=16 unpadded: DIFF 10 | padded: DIFF 10 
* Other controls on the minimal schedule (8 runs each):
  * 8008159 baseline: PG differs 8 of 8 runs (E aborts [T1:serialization T4:serialization])
  * 8008159 abort->commit T1: PG differs 8 of 8 runs (E aborts [T1:serialization T4:serialization])
  * 8008159 abort->commit T2: PG differs 8 of 8 runs (E aborts [T1:serialization T2:serialization T4:serialization])
  * 8008159 abort->commit T4: PG differs 8 of 8 runs (E aborts [T1:serialization T4:serialization])

Minimal schedule:

```
scenario gen-8008159
schedule:
  T4 BEGIN
  T1 BEGIN
  T2 BEGIN
  T2 PUT q:1 = 8
  T3 BEGIN
  T4 SCAN p: AS v4_1
  T1 PUT p:1 = 36
  T4 PUT p:1 = 1
  T3 PUT p:3 = 92
  T4 ABORT
  T2 SCAN p: AS v2_2
  T1 SCAN q: AS v1_3
  T3 COMMIT
  T1 PUT p:3 = 77
  T2 ABORT
  T1 ABORT
```

## seed-8008535

* Classified as: **ser-different-victim (page-level read locks; padding control)** (hints: page-locks, in-transaction-rolled-back)
* engine aborts: T1 at step 15 (READ)  T3 at step 19 (SCAN) 
* PostgreSQL aborts: T3 at step 18 (PUT)
* PostgreSQL's reason text:
  * PostgreSQL: T3: 40001 could not serialize access due to read/write dependencies among transactions | Reason code: Canceled on identification as a pivot, during conflict in checking.
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T2 COMMIT step 14: PASS dependency abort of T1: pivot T1 (in-edge from T3, out-edge to T2, T2 committed first at ts 2)
  * T3 SCAN step 19: PASS dependency abort of T3: pivot T3 (in-edge from T2, out-edge to T2, T2 committed first at ts 2)
* Page-granularity control on the minimal schedule (10 runs each): steps=12 unpadded: DIFF 10 | padded: MATCH 10 
* Other controls on the minimal schedule (8 runs each):
  * 8008535 baseline: PG differs 8 of 8 runs (E aborts [T1:serialization])
  * 8008535 abort->commit T1: PG differs 8 of 8 runs (E aborts [T1:serialization])
  * 8008535 abort->commit T3: PG differs 8 of 8 runs (E aborts [T1:serialization])

Minimal schedule:

```
scenario gen-8008535
schedule:
  T1 BEGIN
  T2 BEGIN
  T1 PUT p:2 = 10
  T3 BEGIN
  T3 READ p:2 AS v3_1
  T2 PUT q:1 = 1
  T2 READ p:1 AS v2_2
  T3 PUT p:1 = 1
  T2 COMMIT
  T1 SCAN q: AS v1_4
  T3 ABORT
  T1 ABORT
```

## seed-8002470

* Classified as: **ser-pivot-before-in-ends (cause not yet established)** (hints: in-transaction-rolled-back)
* engine aborts: T3 at step 19 (PUT)  T4 at step 22 (PUT)  T2 at step 24 (READ) 
* PostgreSQL aborts: T3 at step 19 (PUT)  T2 at step 24 (READ)
* PostgreSQL's reason text:
  * PostgreSQL: T2: 40001 could not serialize access due to read/write dependencies among transactions | Reason code: Canceled on identification as a pivot, during conflict out checking.
  * PostgreSQL: T3: 40001 could not serialize access due to concurrent update
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T1 COMMIT step 21: PASS dependency abort of T2: pivot T2 (in-edge from T4, out-edge to T1, T1 committed first at ts 2)
  * T1 COMMIT step 21: PASS dependency abort of T3: pivot T3 (in-edge from T4, out-edge to T1, T1 committed first at ts 2)
  * T4 PUT step 22: PASS dependency abort of T4: pivot T4 (in-edge from T2, out-edge to T1, T1 committed first at ts 2)
* Page-granularity control on the minimal schedule (10 runs each): steps=12 unpadded: DIFF 10 | padded: DIFF 10 
* Other controls on the minimal schedule (8 runs each):
  * 8002470 baseline: PG differs 8 of 8 runs (E aborts [T4:serialization])
  * 8002470 abort->commit T2: PG differs 8 of 8 runs (E aborts [T2:serialization T4:serialization])
  * 8002470 abort->commit T4: PG differs 8 of 8 runs (E aborts [T4:serialization])

Minimal schedule:

```
scenario gen-8002470
schedule:
  T1 BEGIN
  T2 BEGIN
  T4 BEGIN
  T1 PUT p:2 = 1
  T2 READ p:2 AS v2_1
  T2 READ p:3 AS v2_2
  T2 PUT p:1 = 1
  T4 SCAN p: AS v4_0
  T1 COMMIT
  T4 PUT p:3 = 51
  T4 ABORT
  T2 ABORT
```

## seed-8003140

* Classified as: **ser-abort-earlier-statement (kind `identical` locally)**
* engine aborts: T4 at step 23 (SCAN)  T2 at step 26 (COMMIT)  T3 at step 28 (PUT) 
* PostgreSQL aborts: T2 at step 26 (COMMIT)  T3 at step 28 (PUT)
* PostgreSQL's reason text:
  * PostgreSQL: T2: 40001 could not serialize access due to read/write dependencies among transactions | Reason code: Canceled on identification as a pivot, during commit attempt.
  * PostgreSQL: T3: 40001 could not serialize access due to concurrent update
  * PostgreSQL: T4: 40001 could not serialize access due to read/write dependencies among transactions | Reason code: Canceled on conflict out to pivot 172013, during read.
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T1 COMMIT step 25: PASS dependency abort of T2: pivot T2 (in-edge from T1, out-edge to T1, T1 committed first at ts 2)
  * T1 COMMIT step 25: PASS dependency abort of T3: pivot T3 (in-edge from T1, out-edge to T1, T1 committed first at ts 2)
  * T4 SCAN step 23: PASS dependency abort of T4: pivot T4 (in-edge from T3, out-edge to T1, T1 committed first at ts 2)
* Page-granularity control on the minimal schedule (10 runs each): steps=0 unpadded: | padded: 

Minimal schedule:

```
error: seed-8003140 does not mismatch 5 times in a row at SER
```

## seed-8003201

* Classified as: **ser-different-victim (kind `same-count` locally; the controls point at ser-no-writes-in-edge)**
* engine aborts: T2 at step 24 (READ) 
* PostgreSQL aborts: none
* PostgreSQL's reason text:
  * PostgreSQL: T4: 40001 could not serialize access due to read/write dependencies among transactions | Reason code: Canceled on conflict out to pivot 172098, during read.
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T2 READ step 24: PASS dependency abort of T2: pivot T2 (in-edge from T3, out-edge to T1, T1 committed first at ts 2)
* Page-granularity control on the minimal schedule (10 runs each): steps=16 unpadded: DIFF 10 | padded: DIFF 10 
* Other controls on the minimal schedule (8 runs each):
  * 8003201 baseline: PG differs 8 of 8 runs (E aborts [T2:serialization])
  * 8003201 ro-write T3: PG differs 0 of 8 runs (E aborts [T2:serialization])
  * 8003201 abort->commit T2: PG differs 8 of 8 runs (E aborts [T2:serialization])
  * 8003201 abort->commit T4: PG differs 0 of 8 runs (E aborts [T2:serialization])

Minimal schedule:

```
scenario gen-8003201
schedule:
  T1 BEGIN
  T2 BEGIN
  T4 BEGIN
  T1 PUT q:2 = 1
  T4 READ p:1 AS v4_2
  T3 BEGIN
  T2 PUT q:1 = 87
  T3 READ p:1 AS v3_1
  T1 COMMIT
  T3 READ q:1 AS v3_2
  T4 SCAN p: WHERE == 18 AS v4_5
  T4 PUT p:3 = 1
  T4 ABORT
  T3 COMMIT
  T2 READ q:2 AS v2_4
  T2 ABORT
```

## seed-8004074

* Classified as: **ser-pivot-before-in-ends (cause not yet established)** (hints: in-transaction-rolled-back)
* engine aborts: T3 at step 18 (PUT)  T4 at step 26 (COMMIT) 
* PostgreSQL aborts: T3 at step 18 (PUT)
* PostgreSQL's reason text:
  * PostgreSQL: T3: 40001 could not serialize access due to concurrent update
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T2 COMMIT step 25: PASS dependency abort of T3: pivot T3 (in-edge from T4, out-edge to T2, T2 committed first at ts 3)
  * T2 COMMIT step 25: PASS dependency abort of T4: pivot T4 (in-edge from T3, out-edge to T2, T2 committed first at ts 3)
* Page-granularity control on the minimal schedule (10 runs each): steps=13 unpadded: DIFF 10 | padded: DIFF 10 
* Other controls on the minimal schedule (8 runs each):
  * 8004074 baseline: PG differs 8 of 8 runs (E aborts [T3:serialization T4:serialization])
  * 8004074 abort->commit T3: PG differs 8 of 8 runs (E aborts [T3:serialization T4:serialization])

Minimal schedule:

```
scenario gen-8004074
setup:
  PUT p:2 = 16
schedule:
  T2 BEGIN
  T4 BEGIN
  T3 BEGIN
  T3 PUT q:1 = 60
  T2 SCAN q: AS v2_0
  T3 SCAN p: AS v3_4
  T2 PUT p:1 = 1
  T3 PUT p:1 = 1
  T4 PUT p:2 = 40
  T3 ABORT
  T4 SCAN p: AS v4_4
  T2 COMMIT
  T4 COMMIT
```

## seed-8006837

* Classified as: **ser-different-victim (page-level read locks; padding control)** (hints: page-locks, in-transaction-rolled-back)
* engine aborts: T2 at step 19 (PUT)  T1 at step 29 (COMMIT) 
* PostgreSQL aborts: T2 at step 19 (PUT)
* PostgreSQL's reason text:
  * PostgreSQL: T2: 40001 could not serialize access due to concurrent update
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T3 COMMIT step 28: PASS dependency abort of T1: pivot T1 (in-edge from T2, out-edge to T3, T3 committed first at ts 2)
  * T3 COMMIT step 28: PASS dependency abort of T2: pivot T2 (in-edge from T3, out-edge to T3, T3 committed first at ts 2)
* Page-granularity control on the minimal schedule (10 runs each): steps=13 unpadded: DIFF 10 | padded: MATCH 10 
* Other controls on the minimal schedule (8 runs each):
  * 8006837 baseline: PG differs 8 of 8 runs (E aborts [T1:serialization T2:serialization])
  * 8006837 abort->commit T2: PG differs 8 of 8 runs (E aborts [T1:serialization T2:serialization])

Minimal schedule:

```
scenario gen-8006837
schedule:
  T1 BEGIN
  T2 BEGIN
  T3 BEGIN
  T2 READ p:1 AS v2_1
  T1 READ p:3 AS v1_1
  T2 PUT q:1 = 36
  T3 PUT p:2 = 39
  T2 PUT p:2 = 1
  T1 PUT p:1 = 1
  T1 READ p:2 AS v1_6
  T2 ABORT
  T3 COMMIT
  T1 COMMIT
```

## seed-8006904

* Classified as: **ser-different-victim (page-level read locks; padding control)** (hints: page-locks, in-transaction-rolled-back)
* engine aborts: T2 at step 11 (PUT)  T3 at step 18 (SCAN)  T1 at step 20 (COMMIT) 
* PostgreSQL aborts: T2 at step 11 (PUT)  T1 at step 20 (COMMIT)
* PostgreSQL's reason text:
  * PostgreSQL: T1: 40001 could not serialize access due to read/write dependencies among transactions | Reason code: Canceled on identification as a pivot, during commit attempt.
  * PostgreSQL: T2: 40001 could not serialize access due to concurrent update
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T2 PUT step 11: first-updater-wins abort of T2 (snapshot ts 1) on key q:2: newest committed version ts 2: PASS
  * T3 SCAN step 18: PASS dependency abort of T1: pivot T1 (in-edge from T3, out-edge to T4, T4 committed first at ts 2)
  * T3 SCAN step 18: PASS dependency abort of T3: pivot T3 (in-edge from T1, out-edge to T4, T4 committed first at ts 2)
* Page-granularity control on the minimal schedule (10 runs each): steps=11 unpadded: DIFF 10 | padded: MATCH 10 
* Other controls on the minimal schedule (8 runs each):
  * 8006904 baseline: PG differs 0 of 8 runs (E aborts [T3:serialization])
  * 8006904 abort->commit T3: PG differs 0 of 8 runs (E aborts [T3:serialization])
  * 8006904 abort->commit T1: PG differs 0 of 8 runs (E aborts [T3:serialization])

Minimal schedule:

```
scenario gen-8006904
schedule:
  T4 BEGIN
  T1 BEGIN
  T3 BEGIN
  T1 READ p:3 AS v1_2
  T4 PUT q:2 = 67
  T3 PUT p:3 = 21
  T1 PUT q:1 = 44
  T4 COMMIT
  T3 SCAN q: AS v3_1
  T1 ABORT
  T3 ABORT
```

## seed-8007066

* Classified as: **ser-different-victim (page-level read locks; padding control)** (hints: page-locks, in-transaction-rolled-back)
* engine aborts: T1 at step 14 (READ)  T3 at step 16 (READ) 
* PostgreSQL aborts: T3 at step 16 (READ)
* PostgreSQL's reason text:
  * PostgreSQL: T3: 40001 could not serialize access due to read/write dependencies among transactions | Reason code: Canceled on identification as a pivot, during conflict out checking.
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T2 COMMIT step 13: PASS dependency abort of T3: pivot T3 (in-edge from T2, out-edge to T2, T2 committed first at ts 2)
  * T1 READ step 14: PASS dependency abort of T1: pivot T1 (in-edge from T3, out-edge to T2, T2 committed first at ts 2)
* Page-granularity control on the minimal schedule (10 runs each): steps=12 unpadded: DIFF 10 | padded: MATCH 10 
* Other controls on the minimal schedule (8 runs each):
  * 8007066 baseline: PG differs 8 of 8 runs (E aborts [T1:serialization])
  * 8007066 abort->commit T3: PG differs 8 of 8 runs (E aborts [T1:serialization])
  * 8007066 abort->commit T1: PG differs 8 of 8 runs (E aborts [T1:serialization])

Minimal schedule:

```
scenario gen-8007066
schedule:
  T3 BEGIN
  T3 SCAN q: AS v3_0
  T2 BEGIN
  T1 BEGIN
  T1 PUT q:2 = 13
  T3 PUT q:1 = 1
  T2 PUT p:2 = 28
  T1 READ q:1 AS v1_2
  T2 COMMIT
  T1 READ p:2 AS v1_3
  T1 ABORT
  T3 ABORT
```

## seed-8007073

* Classified as: **ser-no-writes-in-edge** (hints: no-writes-in-edge)
* engine aborts: T1 at step 22 (PUT) 
* PostgreSQL aborts: none
* PostgreSQL's reason text:
  * (PostgreSQL aborts none of these transactions)
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T1 PUT step 22: PASS dependency abort of T1: pivot T1 (in-edge from T2, out-edge to T3, T3 committed first at ts 2)
* Page-granularity control on the minimal schedule (10 runs each): steps=12 unpadded: DIFF 10 | padded: DIFF 10 
* Other controls on the minimal schedule (8 runs each):
  * 8007073 baseline: PG differs 8 of 8 runs (E aborts [T1:serialization])
  * 8007073 ro-write T2: PG differs 0 of 8 runs (E aborts [T1:serialization])
  * 8007073 abort->commit T1: PG differs 8 of 8 runs (E aborts [T1:serialization])

Minimal schedule:

```
scenario gen-8007073
schedule:
  T2 BEGIN
  T1 BEGIN
  T3 BEGIN
  T1 READ q:2 AS v1_0
  T3 PUT p:3 = 20
  T2 READ q:2 AS v2_3
  T3 COMMIT
  T2 SCAN q: AS v2_4
  T2 COMMIT
  T1 READ p:3 AS v1_5
  T1 PUT q:1 = 59
  T1 ABORT
```

## seed-8007083

* Classified as: **ser-pivot-before-in-ends (cause not yet established)** (hints: in-transaction-rolled-back)
* engine aborts: T4 at step 18 (READ)  T2 at step 21 (COMMIT) 
* PostgreSQL aborts: T2 at step 21 (COMMIT)
* PostgreSQL's reason text:
  * PostgreSQL: T2: 40001 could not serialize access due to read/write dependencies among transactions | Reason code: Canceled on identification as a pivot, during commit attempt.
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T1 COMMIT step 17: PASS dependency abort of T2: pivot T2 (in-edge from T3, out-edge to T1, T1 committed first at ts 2)
  * T1 COMMIT step 17: PASS dependency abort of T4: pivot T4 (in-edge from T2, out-edge to T1, T1 committed first at ts 2)
* Page-granularity control on the minimal schedule (10 runs each): steps=12 unpadded: DIFF 10 | padded: DIFF 10 
* Other controls on the minimal schedule (8 runs each):
  * 8007083 baseline: PG differs 8 of 8 runs (E aborts [T4:serialization])
  * 8007083 abort->commit T2: PG differs 8 of 8 runs (E aborts [T2:serialization T4:serialization])

Minimal schedule:

```
scenario gen-8007083
schedule:
  T2 BEGIN
  T1 BEGIN
  T4 BEGIN
  T4 PUT p:3 = 95
  T1 PUT p:1 = 8
  T2 PUT q:2 = 1
  T2 SCAN p: AS v2_4
  T1 SCAN q: AS v1_2
  T4 READ p:1 AS v4_3
  T1 COMMIT
  T2 ABORT
  T4 COMMIT
```

## seed-8007240

* Classified as: **ser-no-writes-in-edge** (hints: no-writes-in-edge)
* engine aborts: T3 at step 13 (PUT)  T1 at step 24 (PUT) 
* PostgreSQL aborts: T3 at step 13 (PUT)
* PostgreSQL's reason text:
  * PostgreSQL: T3: 40001 could not serialize access due to concurrent update
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T3 PUT step 13: first-updater-wins abort of T3 (snapshot ts 1) on key p:2: newest committed version ts 2: PASS
  * T1 PUT step 24: PASS dependency abort of T1: pivot T1 (in-edge from T4, out-edge to T2, T2 committed first at ts 2)
* Page-granularity control on the minimal schedule (10 runs each): steps=11 unpadded: DIFF 10 | padded: DIFF 10 
* Other controls on the minimal schedule (8 runs each):
  * 8007240 baseline: PG differs 8 of 8 runs (E aborts [T1:serialization])
  * 8007240 ro-write T4: PG differs 0 of 8 runs (E aborts [T1:serialization])
  * 8007240 abort->commit T1: PG differs 8 of 8 runs (E aborts [T1:serialization])

Minimal schedule:

```
scenario gen-8007240
schedule:
  T1 BEGIN
  T2 BEGIN
  T4 BEGIN
  T4 READ q:1 AS v4_1
  T2 PUT p:2 = 18
  T1 SCAN p: AS v1_1
  T2 COMMIT
  T4 SCAN q: AS v4_3
  T4 COMMIT
  T1 PUT q:2 = 1
  T1 ABORT
```

## seed-8007459

* Classified as: **ser-different-victim (page-level read locks; padding control)** (hints: page-locks)
* engine aborts: T3 at step 17 (PUT)  T4 at step 21 (PUT) 
* PostgreSQL aborts: T1 at step 18 (COMMIT)
* PostgreSQL's reason text:
  * PostgreSQL: T1: 40001 could not serialize access due to read/write dependencies among transactions | Reason code: Canceled on identification as a pivot, during commit attempt.
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T1 COMMIT step 18: PASS dependency abort of T3: pivot T3 (in-edge from T1, out-edge to T1, T1 committed first at ts 3)
  * T4 PUT step 21: first-updater-wins abort of T4 (snapshot ts 2) on key p:2: newest committed version ts 3: PASS
* Page-granularity control on the minimal schedule (10 runs each): steps=16 unpadded: DIFF 10 | padded: MATCH 10 
* Other controls on the minimal schedule (8 runs each):
  * 8007459 baseline: PG differs 8 of 8 runs (E aborts [T3:serialization T4:serialization])
  * 8007459 abort->commit T4: PG differs 8 of 8 runs (E aborts [T3:serialization T4:serialization])
  * 8007459 abort->commit T3: PG differs 8 of 8 runs (E aborts [T3:serialization T4:serialization])

Minimal schedule:

```
scenario s8007459
schedule:
  T2 BEGIN
  T1 BEGIN
  T1 READ p:3 AS v1_0
  T2 PUT q:1 = 44
  T1 PUT p:2 = 1
  T3 BEGIN
  T4 BEGIN
  T3 READ p:3 AS v3_1
  T2 READ p:2 AS v2_1
  T2 COMMIT
  T4 SCAN q: AS v4_0
  T1 COMMIT
  T3 PUT p:2 = 1
  T4 PUT p:2 = 77
  T3 ABORT
  T4 ABORT
```

## seed-8008512

* Classified as: **ser-different-victim (page-level read locks; padding control)** (hints: page-locks, in-transaction-rolled-back)
* engine aborts: T2 at step 17 (PUT)  T3 at step 19 (PUT)  T1 at step 21 (PUT) 
* PostgreSQL aborts: T2 at step 17 (PUT)  T1 at step 21 (PUT)
* PostgreSQL's reason text:
  * PostgreSQL: T1: 40001 could not serialize access due to concurrent update
  * PostgreSQL: T2: 40001 could not serialize access due to concurrent update
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T4 COMMIT step 15: PASS dependency abort of T1: pivot T1 (in-edge from T2, out-edge to T4, T4 committed first at ts 2)
  * T2 PUT step 17: first-updater-wins abort of T2 (snapshot ts 1) on key p:3: newest committed version ts 2: PASS
  * T3 PUT step 19: PASS dependency abort of T3: pivot T3 (in-edge from T1, out-edge to T4, T4 committed first at ts 2)
* Page-granularity control on the minimal schedule (10 runs each): steps=11 unpadded: DIFF 10 | padded: MATCH 10 
* Other controls on the minimal schedule (8 runs each):
  * 8008512 baseline: PG differs 8 of 8 runs (E aborts [T3:serialization])
  * 8008512 abort->commit T3: PG differs 8 of 8 runs (E aborts [T3:serialization])
  * 8008512 abort->commit T1: PG differs 8 of 8 runs (E aborts [T3:serialization])

Minimal schedule:

```
scenario gen-8008512
schedule:
  T4 BEGIN
  T1 BEGIN
  T1 READ p:2 AS v1_0
  T3 BEGIN
  T3 READ q:1 AS v3_1
  T4 PUT q:1 = 75
  T1 PUT p:1 = 72
  T4 COMMIT
  T3 PUT p:2 = 1
  T1 ABORT
  T3 ABORT
```

## seed-8008548

* Classified as: **ser-pivot-before-in-ends (cause not yet established)** (hints: in-transaction-rolled-back)
* engine aborts: T3 at step 17 (READ)  T4 at step 18 (SCAN)  T1 at step 24 (COMMIT) 
* PostgreSQL aborts: T3 at step 17 (READ)  T4 at step 18 (SCAN)
* PostgreSQL's reason text:
  * PostgreSQL: T3: 40001 could not serialize access due to read/write dependencies among transactions | Reason code: Canceled on conflict out to pivot 172502, during read.
  * PostgreSQL: T4: 40001 could not serialize access due to read/write dependencies among transactions | Reason code: Canceled on conflict out to pivot 172502, during read.
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T4 SCAN step 18: PASS dependency abort of T1: pivot T1 (in-edge from T4, out-edge to T2, T2 committed first at ts 2)
  * T4 SCAN step 18: PASS dependency abort of T4: pivot T4 (in-edge from T1, out-edge to T2, T2 committed first at ts 2)
  * T3 READ step 17: PASS dependency abort of T3: pivot T3 (in-edge from T1, out-edge to T2, T2 committed first at ts 2)
* Page-granularity control on the minimal schedule (10 runs each): steps=12 unpadded: DIFF 10 | padded: DIFF 10 
* Other controls on the minimal schedule (8 runs each):
  * 8008548 baseline: PG differs 8 of 8 runs (E aborts [T1:serialization T4:serialization])
  * 8008548 abort->commit T4: PG differs 8 of 8 runs (E aborts [T1:serialization T4:serialization])

Minimal schedule:

```
scenario gen-8008548
schedule:
  T2 BEGIN
  T4 BEGIN
  T1 BEGIN
  T1 SCAN p: AS v1_0
  T2 PUT q:1 = 1
  T4 PUT p:3 = 47
  T2 COMMIT
  T1 READ q:1 AS v1_2
  T1 PUT q:2 = 1
  T4 SCAN q: AS v4_2
  T1 COMMIT
  T4 ABORT
```

## seed-8006497

* Classified as: **ser-pivot-before-in-ends (cause not yet established)** (hints: in-transaction-rolled-back)
* engine aborts: T1 at step 17 (PUT)  T2 at step 20 (COMMIT) 
* PostgreSQL aborts: T1 at step 17 (PUT)
* PostgreSQL's reason text:
  * PostgreSQL: T1: 40001 could not serialize access due to concurrent update
* Reproduces: 5 of 5 re-runs differed from the engine
* Spec 4.8 / 4.6 re-derived from the engine's trace:
  * T3 COMMIT step 16: PASS dependency abort of T1: pivot T1 (in-edge from T2, out-edge to T3, T3 committed first at ts 2)
  * T3 COMMIT step 16: PASS dependency abort of T2: pivot T2 (in-edge from T1, out-edge to T3, T3 committed first at ts 2)
* Page-granularity control on the minimal schedule (10 runs each): steps=12 unpadded: DIFF 10 | padded: DIFF 10 
* Other controls on the minimal schedule (8 runs each):
  * 8006497 baseline: PG differs 8 of 8 runs (E aborts [T2:serialization])
  * 8006497 abort->commit T1: PG differs 8 of 8 runs (E aborts [T2:serialization])

Minimal schedule:

```
scenario gen-8006497
schedule:
  T1 BEGIN
  T3 BEGIN
  T2 BEGIN
  T1 READ q:1 AS v1_0
  T2 SCAN p: AS v2_2
  T2 PUT p:3 = 75
  T3 PUT p:2 = 48
  T1 SCAN p: AS v1_2
  T1 PUT q:1 = 63
  T3 COMMIT
  T2 COMMIT
  T1 ABORT
```

