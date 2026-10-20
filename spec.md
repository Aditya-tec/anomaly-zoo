# Anomaly Zoo — End-to-End Build Specification

> Watch database isolation bugs happen. Then turn them off.

**Owner:** Aditya Kalambe (GitHub: `Aditya-tec`) · **Spec version:** 1.0 · **Date:** 2026-10-20
**Audience:** a coding agent that implements this repo end to end, and the human who reviews its work.

---

## 0. How to use this document (read first)

1. **Build in phase order (§12).** Do not start phase N+1 until phase N's acceptance criteria (AC) pass in CI.
2. **This spec is the contract.** The engine semantics in §4 are verified against PostgreSQL. If something is ambiguous or impossible, write the question and your chosen default in `docs/DECISIONS.md`, flag it in the PR description, and continue with the safest option. Never silently change §4.
3. **Free-only, no card, ever.** No paid service and no service that asks for a payment method at signup. Before adding any external service or dependency, record its free-tier terms in `docs/DECISIONS.md`. The approved list is §2.
4. **[VERIFY]** marks a fact the spec author could not confirm against a primary source. Confirm it before relying on it or printing it in public copy.
5. **Honest claims only.** §13.3 lists what may and may not be claimed publicly.
6. **Determinism.** The engine must be deterministic: no wall clock, no randomness (tests use fixed seeds), no goroutines inside the engine, sorted map iteration.
7. **Commit identity.** Commit as the repo owner only. Do not add co-author trailers or tool-attribution lines.
8. **Definition of done (every phase):** tests green, linters clean, docs updated, AC ticked in `docs/PROGRESS.md`.
9. **Do not gold-plate.** §1.4 lists non-goals. Ideas outside this spec go to `docs/BACKLOG.md`.

---

## 1. Product brief

### 1.1 What it is
An interactive museum of database concurrency bugs. A from-scratch transactional engine (MVCC) runs scripted two- and three-transaction schedules at four isolation levels. The visitor steps through a schedule, watches a bug happen, flips the isolation level, replays, and watches the bug disappear, with the exact mechanism shown (snapshot visibility, lock wait, first-updater-wins abort, SSI abort).

### 1.2 Why people use it
| Situation | What they do here |
|---|---|
| Preparing for backend / system-design interviews | Learn what each isolation level really prevents, then share the link |
| Just hit a race condition (wrong balance, duplicate row) | Search the anomaly name, land on its page, see the failure reproduced |
| Teaching / learning databases | Link the page instead of drawing on a whiteboard |
| Engineers testing an assumption ("I used a transaction, so I'm safe") | Run the scenario at their level in 30 seconds |

### 1.3 Core journeys
- **J1 Learn:** open `/anomalies/write-skew` → read the 3-sentence story → step through the schedule → see the anomaly → flip the level → replay → see it prevented.
- **J2 Compare:** open `/` → see the "habitat map" (anomaly × isolation level) → click any cell to jump into that run.
- **J3 Experiment:** open `/playground` → edit a schedule in the small DSL → run it at all four levels → share the link.
- **J4 Trust:** open `/about` → read methodology, limits, and the PostgreSQL conformance report.

### 1.4 Non-goals (do not build)
SQL parsing, indexes, durability/WAL, real multi-threaded concurrency, networking, user accounts, a backend or database, analytics that need consent, a plugin system, multi-version vendor emulation (MySQL, Oracle, SQL Server).

### 1.5 Principles
1. **The matrix is computed, never hard-coded.** CI runs the engine and asserts the result against `expected.json`.
2. **Every claim has a runnable proof** (a scenario, a test, or a conformance result).
3. **State limits openly** (§13.3).
4. **Zero backend.** Static files only, so a traffic spike cannot take it down.

### 1.6 Leading indicators to track (no targets)
GitHub stars, repo Traffic (views/clones, free in GitHub Insights), post impressions, inbound DMs from founders/CTOs, links from other sites.

---

## 2. Constraints and approved free stack

Researched 2026-10-20. Terms change; re-check each before launch (AC in §12).

| Service | Used for | Card needed? | Limits that matter |
|---|---|---|---|
| GitHub (public repo) | Code, Actions CI, Releases, Dependabot | No | Standard runners are free for public repos. Larger runners are billed even on public repos, so **never use larger runners**. |
| Vercel Hobby | Production hosting of the static site, preview deploys, response headers | No | Non-commercial use only (fine for a portfolio project). ~100 GB transfer/month; serverless limits are irrelevant (no functions). |
| GitHub Pages (fallback) | Backup hosting | No | 1 GB site, soft 100 GB/month, soft 10 builds/hour, **cannot set custom response headers**. |
| Cloudflare Pages (fallback) | Backup hosting | Free plan: [VERIFY] at signup | Static asset requests free and unlimited. |
| PostgreSQL service container in GitHub Actions | Conformance tests only, never deployed | No | Runs on Ubuntu runners; public-repo minutes are free. |

**Deliberately not used:**
- **Render:** free services sleep after 15 minutes idle and have a 30-day Postgres. A backend would add cold starts and a failure mode under viral traffic.
- **Supabase:** nothing to store. Free projects also pause after a week idle.
- **Fly.io, Koyeb, Northflank, Cloudflare R2:** all require a card.
- **Any analytics service** in v1 (privacy, plus unverified free terms). Use GitHub Traffic.

---

## 3. High-level design (HLD)

### 3.1 Architecture

```
                         BUILD / CI TIME                                   RUNTIME (browser only)
 ┌───────────────────────────────────────────────────────┐      ┌───────────────────────────────────────────┐
 │ scenarios/*.azs ──► Go engine (native) ──► traces/*.json│      │ Next.js static site (Vercel Hobby)         │
 │        │                │   ▲                          │      │  /            habitat map (static JSON)    │
 │        │                │   └── oracle, property tests │      │  /anomalies/* step-through (static JSON)   │
 │        │                ▼                              │      │  /playground  editor ──► Web Worker        │
 │        │        expected.json  (asserted in CI)        │      │                          │                 │
 │        ▼                                               │      │                          ▼                 │
 │  PostgreSQL service container ◄── conformance harness  │      │                  azoo.wasm (same engine)    │
 │        └──► web/public/conformance.json                │      │  "Re-run in your browser" ✓ matches trace  │
 └───────────────────────────────────────────────────────┘      └───────────────────────────────────────────┘
```

### 3.2 Components
| Component | Responsibility |
|---|---|
| `engine` (Go, stdlib only) | MVCC store, transaction manager, write locks, deadlock detection, SSI, runner, oracle, trace emitter |
| `dsl` (Go) | Parse and validate `.azs` scenario files; enforce limits |
| `cmd/azoo` (Go CLI) | `run`, `matrix`, `gen` (random schedules), `traces` (emit static JSON) |
| `cmd/wasm` (Go, `js/wasm`) | Expose the engine to the browser (§5.9) |
| `conformance` (separate Go module) | Run the same schedules on real PostgreSQL and compare (§9.4) |
| `web` (Next.js static export) | UI: map, anomaly pages, playground, about |
| `web/public/engine/` | `azoo.wasm`, `wasm_exec.js` (committed, reproducibility-checked, §11.3) |

### 3.3 Data flow
`.azs` source → `dsl.Parse` → `Scenario` → `Run(scenario, level)` → `Trace` (JSON). The CLI, CI, WASM, and UI all consume the same Trace JSON schema (§5.8). Canned scenarios ship as **pre-generated static trace files**, so the home page and anomaly pages work without loading WASM. WASM loads only on `/playground` and when the visitor clicks "Re-run in your browser".

### 3.4 Key decisions and alternatives
| Decision | Why | Alternative considered |
|---|---|---|
| Engine in **Go**, one codebase for native + WASM | Native fuzzing (`go test -fuzz`), property tests, and a Postgres differential harness all in one language; consistent with Meridian; builds the Go skill you are targeting | TypeScript engine: simpler browser story, but weaker fuzz/conformance tooling and no new Go signal. **Fallback if the WASM size gate fails** (§12 P0). |
| Standard Go compiler to WASM | Full stdlib; official support. Hello-world is about 2 MB raw (~500 KB gzip); budget set accordingly | TinyGo: much smaller but limited stdlib and reflection; use only if the gate fails |
| Static export, no backend | No cold starts, no caps, tiny attack surface | Render/Supabase backend: adds failure modes for no benefit |
| Pre-generated traces for canned scenarios | Fast first load, SEO-friendly pages, golden files | Run everything in WASM: slower, no SEO |
| Custom text DSL, not SQL | Deterministic, small, easy to fuzz | SQL subset: huge scope |
| `<textarea>` editor | Keeps bundle small | Monaco/CodeMirror: heavy for v1 |
| Next.js `output: 'export'` | Familiar stack; static routes per anomaly | Vite SPA (stricter CSP possible, no prerender); see §10 CSP note |

### 3.5 Repository layout
```
anomaly-zoo/
├─ go.mod                       # module github.com/Aditya-tec/anomaly-zoo (stdlib only)
├─ engine/
│  ├─ mvcc/        store.go version.go visibility.go
│  ├─ txn/         manager.go locks.go deadlock.go
│  ├─ ssi/         tracker.go dangerous.go
│  ├─ dsl/         lexer.go parser.go ast.go validate.go expr.go
│  ├─ run/         runner.go wake.go
│  ├─ oracle/      serializable.go detectors.go shrink.go
│  └─ trace/       types.go reasons.go
├─ scenarios/      *.azs  expected.json
├─ cmd/azoo/       main.go
├─ cmd/wasm/       main.go    # build tag js && wasm
├─ conformance/    go.mod (own module, uses pgx)  main.go harness/
├─ web/
│  ├─ app/ (App Router)  components/  lib/  public/{engine,traces,conformance.json}
│  ├─ scripts/ inject-csp.mjs  gen-sitemap.mjs  size-gate.mjs
│  └─ e2e/ (Playwright)
├─ docs/  DECISIONS.md PROGRESS.md BACKLOG.md METHODOLOGY.md
├─ .github/workflows/  ci.yml  conformance.yml  fuzz.yml  codeql.yml
├─ vercel.json   Makefile   README.md   LICENSE (MIT)
```

### 3.6 Environments
Local (`make dev`), CI (GitHub Actions), Preview (Vercel preview per PR), Production (Vercel `main`).

### 3.7 Non-functional requirements
| Area | Requirement |
|---|---|
| Performance | Home page first-load JS ≤ 150 KB gzip (excluding WASM). LCP ≤ 2.5 s on a mid-range phone profile (Lighthouse CI). Engine run per scenario < 20 ms. |
| WASM size | ≤ 1.0 MB gzip target; **CI fails above 1.5 MB gzip** |
| Accessibility | WCAG 2.2 AA, full keyboard use, no information by color alone, `prefers-reduced-motion` respected |
| Browsers | Last 2 versions of Chrome, Firefox, Safari, Edge; mobile Safari and Chrome |
| Privacy | No cookies, no analytics, no third-party requests (self-hosted fonts or system font stack) |
| Availability | Static CDN hosting; no server dependencies |
| Reproducibility | Same input → byte-identical trace on every platform (§4.11) |

---

## 4. Engine semantics (the contract)

### 4.1 Data model
- **Store:** a map from `Key` (string) to a **version chain**. Values are `int64` (range ±1,000,000,000).
- **Version:** `{writer TxnID, value int64, deleted bool, commitTS uint64}`. `commitTS == 0` means uncommitted.
- **Chain invariant:** versions are ordered oldest → newest; committed versions are ordered by `commitTS`; there is **at most one uncommitted version per key, always last** (guaranteed by write locks).
- **Clock:** a logical counter `clock`. It increments only at commit: `commitTS = ++clock`. Setup data is committed by an implicit transaction `T0` at `commitTS = 1`.
- **Concurrent:** transaction A is concurrent with B if neither committed before the other's snapshot, i.e. B uncommitted, or `B.commitTS > A.snapshotTS`.

### 4.2 Operations
| Op | Meaning |
|---|---|
| `BEGIN` | Start a transaction. No snapshot yet. |
| `READ k AS v` | Read one key. Absent → `v = 0` and trace flag `absent: true`. |
| `SCAN prefix [WHERE op int] AS s` | Read all visible keys with the prefix, optionally filtered by value. `count(s)` and `sum(s)` are usable later. |
| `PUT k = expr` | Upsert (insert or update). |
| `DELETE k` | Delete (writes a tombstone version). |
| `COMMIT` / `ABORT` | End the transaction. |

### 4.3 Isolation levels
| Level (id) | Reads see | Snapshot taken | Write–write rule | SSI tracking |
|---|---|---|---|---|
| Read Uncommitted (`RU`) | Newest version, **including other transactions' uncommitted writes** | none | Write locks only | no |
| Read Committed (`RC`) | Newest **committed** version as of the **start of this statement** | per statement | Write locks only; after waking, the write proceeds (last writer wins) | no |
| Snapshot Isolation (`SI`) | Committed versions with `commitTS ≤ snapshotTS` | at the transaction's **first data operation** | Write locks + **first-updater-wins** (§4.6) | no |
| Serializable (`SER`) | Same as `SI` | same as `SI` | same as `SI` | **yes** (§4.8) |

Every level always lets a transaction see **its own** uncommitted writes.

Notes for UI copy and README (do not overstate):
- `SI` is the textbook name. PostgreSQL's `REPEATABLE READ` is snapshot isolation [VERIFY against PostgreSQL docs, chapter on transaction isolation]. Conformance maps `RC→READ COMMITTED`, `SI→REPEATABLE READ`, `SER→SERIALIZABLE`.
- PostgreSQL has no true Read Uncommitted (it treats it as Read Committed) [VERIFY]. `RU` exists here purely to show dirty reads, so it is **excluded from conformance**.
- The ANSI SQL definition of REPEATABLE READ allows phantoms; snapshot isolation does not for repeated reads of the same predicate. Say so on the page.

### 4.4 Visibility (pseudocode)
```
visible(chain, reader, level, stmtTS) -> version or none:
  if chain.last.writer == reader and chain.last.commitTS == 0: v = chain.last          # own write
  elif level == RU:  v = chain.last                                                   # may be uncommitted by others
  elif level == RC:  v = newest version with commitTS != 0 and commitTS <= stmtTS     # stmtTS = clock now
  else (SI|SER):     v = newest version with commitTS != 0 and commitTS <= reader.snapshotTS
  if v is none or v.deleted: return none
  return v
```
`SCAN` iterates keys with the prefix in **sorted order**, applies `visible`, then the value predicate.

### 4.5 Write locks and blocking
- Every `PUT`/`DELETE` needs the key's **write lock**, at every level, including keys that do not exist yet. Locks are held until the transaction commits or aborts.
- If another transaction holds the lock, the statement returns **Blocked(on = holder)**. Reads never block.
- Blocked statements are retried in FIFO order when the holder finishes (§4.11).

### 4.6 First-updater-wins (SI and SER only)
When a transaction acquires a key's write lock (immediately or after waking): if the key's newest **committed** version has `commitTS > snapshotTS`, abort the transaction with reason `abort_concurrent_update`. At `RU`/`RC` no such check exists (last writer wins), which is exactly what allows lost updates.

### 4.7 Commit and abort
- `COMMIT`: for `SER`, run the SSI check (§4.8) first; then `commitTS = ++clock`, stamp the transaction's uncommitted versions, release locks, wake waiters.
- `ABORT` or any engine-initiated abort: delete the transaction's uncommitted versions, release locks, discard its SSI edges, wake waiters.
- Operations of an already-aborted transaction are **skipped** (status `skipped`, reason `skipped_txn_aborted`), including its `COMMIT`.

### 4.8 Serializable level: SSI ("SSI-lite")
Algorithm after Cahill, Röhm and Fekete (2008) and PostgreSQL's implementation by Ports and Grittner (2012) [VERIFY citations before printing]. Simplifications are limits (§13.3): no read-only optimisation, predicate locks are **key-prefix only** (value filters ignored), nothing is summarised or evicted.

**State per transaction:** `readKeys`, `readPrefixes` (SIREAD locks), `in` and `out` sets of rw-antidependency edges, `doomed` flag.

**rw edge `A → B`:** A read something B overwrote (or inserted) while they were concurrent.

**Creating edges**
1. On `READ k` by A: for every version of `k` that A cannot see and whose writer B ≠ A is uncommitted or has `commitTS > A.snapshotTS` → edge `A → B`.
2. On `SCAN p` by A: for every key under prefix `p` with such an invisible version → edge `A → B`. Record `p` in `A.readPrefixes`.
3. On a successful write of `k` by B: for every other transaction A that holds a SIREAD lock covering `k` (`k ∈ readKeys` or `k` has a prefix in `readPrefixes`) and is concurrent with B (A active, or `A.commitTS > B.snapshotTS`) → edge `A → B`.
4. Edges to or from aborted transactions are discarded.

**Dangerous structure (pivot `P`):** `P` has an in-edge from `I` and an out-edge to `O` (`I` may equal `O`), `O` is committed, and `O` committed **before** every member of `{I, P}` other than `O` (uncommitted counts as later).
```
dangerous(P):
  for I in P.in: for O in P.out:
    if O.committed:
      ok = true
      for X in {I, P} \ {O}: if X.committed and X.commitTS < O.commitTS: ok = false
      if ok: return (I, O)
  return none
```

**When to check, and who dies**
- After adding any edge: check both endpoints as pivot.
- At `COMMIT` of C (before assigning `commitTS`): if C is a pivot with a committed `O` → abort C.
- After C commits: every active transaction `P` with `C ∈ P.out` is re-checked.
- **Victim:** the pivot if it is active; otherwise `I` if active. If the victim is the transaction executing the current step, abort now (reason `abort_dependencies`). Otherwise set `victim.doomed`; its next operation (including `COMMIT`) aborts with that reason.

### 4.9 Deadlocks
When a statement blocks, add wait-for edge `requester → holder`. If this closes a cycle through the requester, **abort the requester** with reason `abort_deadlock`. (PostgreSQL aborts whichever transaction runs the detector after `deadlock_timeout`, so the victim can differ in some schedules. Conformance compares outcome class only for the deadlock scenario.)

### 4.10 Schedule validation (static, before running)
Every transaction: first step is `BEGIN`, last step is `COMMIT` or `ABORT`, exactly one of each, no steps after its end. Limits: ≤ 6 transactions, ≤ 200 steps, ≤ 64 distinct keys, key ≤ 32 chars, identifier ≤ 16 chars, source ≤ 8 KB.

### 4.11 Runner scheduling and determinism
Process schedule steps in order. For step `(Tn, op)`:
1. If `Tn` is aborted → record `skipped`.
2. If `Tn` has a pending blocked statement → append the step to `Tn.queue` (status `queued`).
3. Otherwise execute; result is `ok`, `blocked`, or `aborted`.

**Wake loop** (runs after any commit/abort, until quiescent): visit blocked transactions in block order (FIFO); if its lock is now free, acquire it, apply §4.6, execute the pending statement, then drain its queue in order until it blocks again, ends, or the queue is empty. A drained `COMMIT` may release locks; repeat.

At the end of the schedule, any transaction still blocked is reported `blocked_at_end` and rolled back.

The trace records both `scheduledIndex` (position in the script) and `index` (actual execution order). No goroutines, no clock, sorted iteration ⇒ byte-identical output across machines.

---

## 5. Low-level design (LLD)

The behavioural contract is **§4 plus the trace schema (§5.8)**. The Go API below is a recommended shape; deviate if you must, but keep package boundaries (dependency direction `trace ← mvcc ← txn ← ssi ← run`; `dsl` independent; `oracle` depends on `mvcc` and `dsl`).

### 5.1 Core types
```go
type Level string      // "RU" | "RC" | "SI" | "SER"
type TxnID string      // "T1".."T6"
type Key string        // [a-z0-9:._-]{1,32}
type Value = int64     // |v| <= 1_000_000_000

type Version struct {
    Writer   TxnID
    Value    Value
    Deleted  bool
    CommitTS uint64 // 0 = uncommitted
}

type Txn struct {
    ID          TxnID
    Status      Status // Active | Committed | Aborted
    HasSnapshot bool
    SnapshotTS  uint64
    CommitTS    uint64
    Locks       map[Key]struct{}
    Vars        map[string]Binding // variable name -> value or rows
    ReadKeys    map[Key]struct{}   // SIREAD (SER only)
    ReadPrefix  map[string]struct{}
    In, Out     map[TxnID]Edge     // rw edges (SER only)
    Doomed      *AbortReason
    Pending     *Step              // blocked statement, if any
    Queue       []Step             // later steps held behind Pending
}

type Outcome struct {
    Status    OutcomeStatus // OK | Blocked | Aborted
    BlockedOn TxnID
    Reason    AbortReason
    Detail    string
}
```

### 5.2 Manager behaviour (pseudocode)
```
ensureSnapshot(T): if level in {SI,SER} and !T.HasSnapshot: T.SnapshotTS = clock; T.HasSnapshot = true
stmtTS()         : clock   // RC uses this per statement

Read(T,k):
  if T.Doomed: return abort(T, *T.Doomed)
  ensureSnapshot(T)
  v = visible(chain[k], T, level, stmtTS())
  if level == SER: ssi.onRead(T, k)                 // may abort T
  bind variable; emit read effect with 'why' reason code

Scan(T, prefix, filter):
  same as Read but over sorted keys with the prefix; SER also records prefix and
  creates edges for every invisible version under the prefix

Put(T,k,v) / Delete(T,k):
  if T.Doomed: return abort(T, *T.Doomed)
  ensureSnapshot(T)
  if T already holds lock[k]: overwrite own uncommitted version; goto ssiWrite
  h = lock[k]
  if h != none and h != T:
      waitFor[T] = h
      if cycle(waitFor, from=h, reaches=T): abort(T, abort_deadlock); return Aborted
      return Blocked(h)                              // statement stays pending (runner)
  lock[k] = T
  if level in {SI,SER} and newestCommitted(k).CommitTS > T.SnapshotTS:
      abort(T, abort_concurrent_update); return Aborted
  append own uncommitted version
ssiWrite:
  if level == SER: ssi.onWrite(T,k)                   // may abort T

Commit(T):
  if T.Doomed: return abort(T, *T.Doomed)
  if level == SER and ssi.dangerousAtCommit(T): abort(T, abort_dependencies); return Aborted
  T.CommitTS = ++clock; stamp T's versions; T.Status = Committed
  release locks; if level == SER: ssi.afterCommit(T)  // may doom active transactions
```
Because each transaction has at most one pending statement, the wait-for graph has out-degree ≤ 1 and cycle detection is a pointer chase.

If a waiter is resumed but an **earlier waiter** took the lock in the same wake loop, the later waiter stays blocked on the new holder (update `waitFor`, re-run deadlock detection).

### 5.3 DSL (`.azs`) grammar
```
file       := scenario
scenario   := 'scenario' ID NL
              ['title' STRING NL] ['story' STRING NL]
              { 'invariant' STRING ':' cmpExpr NL }
              ['setup:' NL { INDENT 'PUT' KEY '=' INT NL }]
              'schedule:' NL { INDENT step NL }
step       := TXN op
TXN        := 'T' [1-6]
op         := 'BEGIN' | 'COMMIT' | 'ABORT'
            | 'READ' KEY 'AS' ID
            | 'SCAN' PREFIX [ 'WHERE' CMP INT ] 'AS' ID
            | 'PUT' KEY '=' expr
            | 'DELETE' KEY
            | 'NOTE' STRING                       # annotation only; shown in UI, no effect
expr       := term { ('+'|'-') term }             # PUT only; may use variables bound earlier by the SAME txn
term       := INT | ID | 'count(' ID ')' | 'sum(' ID ')'
cmpExpr    := fexpr CMP fexpr
fexpr      := fterm { ('+'|'-') fterm }
fterm      := INT [ '*' fatom ] | fatom
fatom      := ID | 'count(' ID ')' | 'sum(' ID ')'
            | 'final.val(' STRING ')'
            | 'final.count(' STRING [ 'WHERE' CMP INT ] ')'
            | 'final.sum(' STRING ')'
            | 'committed(' TXN ')'                # 1 if committed else 0
CMP        := '==' | '!=' | '<' | '<=' | '>' | '>='
ID         := [a-z][a-z0-9_]{0,15}               # not: count sum final committed
KEY        := [a-z0-9:._-]{1,32}
PREFIX     := KEY (non-empty)
```
Rules: `#` starts a comment; keywords are upper-case; variables are **single-assignment** across the scenario (rebinding is a validation error); an unbound variable in an invariant means that invariant is **not violated** (status `n/a`, with a note); `READ` of an absent key binds `0` and flags `absent`; integer arithmetic is checked, and a result outside ±1,000,000,000 aborts the statement's transaction with reason `runtime_error`. Playground scenarios may omit `title`, `story`, `invariant`, and `setup`.

Parser requirements: hand-written lexer and recursive-descent parser, **no regex backtracking**, errors with `line`, `col`, and a human message, at most 20 errors reported, never panics (fuzzed, §9.5).

### 5.4 Invariants and oracle verdicts
Two independent signals per run:
1. **Invariant** (pedagogical, per scenario): evaluated after the schedule ends → `holds`, `violated`, or `n/a`.
2. **Serializability oracle** (universal): is the history of **committed** transactions equivalent to some serial order?

A matrix cell reads **"occurs"** when an invariant is violated and **"prevented"** otherwise. The playground (no invariants) shows only the oracle verdict plus a witness.

### 5.5 Serializability oracle (`engine/oracle`)
Input: setup state, committed transactions (their op lists and the **observed** read results), final state.
Algorithm: for each permutation of committed transactions (≤ 6! = 720; property tests use ≤ 4 transactions), run them **serially on a fresh store**, each atomically. Accept the permutation iff every `READ`/`SCAN` returns exactly what was observed in the concurrent run **and** the final state equals the observed final state. Verdict is `true` with the first accepting order (`witnessOrder`), otherwise `false`. Because `PUT` expressions recompute from reads, a mismatch also appears as a different final state.
Also provide a **shrinker**: given a failing generated schedule, repeatedly delete steps/transactions/keys while the failure persists, then print the minimal `.azs`.

### 5.6 Runner (`engine/run`)
Implements §4.11. After each executed event: if a transaction committed or aborted, run the wake loop. Wake order is **block order** (FIFO). At schedule end, roll back transactions that are still blocked (`blocked_at_end`), then evaluate invariants and the oracle.

### 5.7 Reason codes (stable ids, used by the UI)
| Code | Meaning shown to the user |
|---|---|
| `visible_own_write` | "Read its own uncommitted write." |
| `visible_committed_at_statement` | "Saw the newest value committed when this statement started." (RC) |
| `visible_committed_before_snapshot` | "Saw the value committed before this transaction's snapshot." (SI/SER) |
| `visible_dirty` | "Saw a value its writer has **not** committed. (dirty read)" (RU) |
| `invisible_newer_than_snapshot` | "A newer committed version exists but is hidden by the snapshot." |
| `invisible_uncommitted_other` | "Another transaction's uncommitted write is hidden." |
| `absent` | "The key does not exist (or is deleted) for this reader." |
| `lock_acquired` | "Took the write lock on the key." |
| `blocked_on_lock` | "Waiting: Tn holds the write lock on this key." |
| `lock_granted_after_wait` | "Tn finished; the lock was granted and the statement ran." |
| `rw_edge_added` | "Recorded a read→write dependency Ta → Tb (Ta read what Tb changed)." (SER) |
| `abort_concurrent_update` | "Aborted: could not serialize access due to a concurrent update (first updater wins)." |
| `abort_dependencies` | "Aborted: could not serialize access due to read/write dependencies among transactions." |
| `abort_deadlock` | "Aborted: deadlock detected." |
| `abort_user` | "The transaction rolled back." |
| `abort_runtime_error` | "Aborted: arithmetic out of range." |
| `skipped_txn_aborted` | "Skipped: this transaction already aborted." |
| `blocked_at_end` | "Still waiting when the schedule ended; rolled back." |

The two `abort_*` serialization texts intentionally echo PostgreSQL's wording [VERIFY exact PostgreSQL error messages before quoting them verbatim].

### 5.8 Trace JSON schema (v1)
One file per (scenario, level). **Canonical JSON:** UTF-8, keys sorted, no insignificant whitespace in the digest input, integers only, no timestamps. `digest` = hex SHA-256 of the canonical JSON **without** the `digest` field. Ship `trace.schema.json` (JSON Schema 2020-12) and validate every emitted trace against it in tests.
```jsonc
{
  "schemaVersion": 1,
  "engineVersion": "1.0.0",
  "scenario": { "id": "write-skew", "title": "...", "story": "...",
                "invariants": [ { "name": "...", "expr": "final.count(\"doctor:\" WHERE == 1) >= 1" } ] },
  "level": "SI",
  "setup": [ { "key": "doctor:alice", "value": 1 } ],
  "steps": [ {
      "index": 4, "scheduledIndex": 4, "resumed": false,
      "txn": "T1", "op": "SCAN",
      "args": { "prefix": "doctor:", "where": { "cmp": "==", "value": 1 }, "as": "oncall_t1" },
      "status": "ok",                      // ok | blocked | aborted | skipped | queued
      "snapshotTS": 1, "stmtTS": 1,
      "result": { "rows": [ { "key": "doctor:alice", "value": 1 } ], "count": 2, "sum": 2 },
      "reads": [ { "key": "doctor:alice", "from": { "writer": "T0", "commitTS": 1 },
                   "why": "visible_committed_before_snapshot" } ],
      "effects": [ { "kind": "rw_edge", "from": "T2", "to": "T1", "via": "doctor:" } ],
      "storeAfter": [ { "key": "doctor:alice", "versions": [ { "writer": "T0", "value": 1, "deleted": false, "commitTS": 1 } ] } ],
      "note": null
  } ],
  "txns": [ { "id": "T1", "status": "committed", "snapshotTS": 1, "commitTS": 2, "abortReason": null } ],
  "finalState": [ { "key": "doctor:alice", "value": 0 } ],
  "invariants": [ { "name": "...", "status": "violated", "detail": "lhs=0 rhs=1" } ],
  "serializable": { "verdict": false, "witnessOrder": null },
  "digest": "..."
}
```
Event semantics: `steps` are **events in execution order**. A statement that blocks yields a `blocked` event; when it later runs, a new `resumed: true` event carries the same `scheduledIndex`. Steps queued behind a blocked statement yield a `queued` event at their scheduled position and a `resumed` event when drained. `effects[].kind` ∈ `lock_acquired | lock_wait | lock_released | version_created | commit | abort | rw_edge | doomed`.

### 5.9 WASM API (`cmd/wasm`)
Build: `GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o web/public/engine/azoo.wasm ./cmd/wasm`. Copy `wasm_exec.js` from the **same Go toolchain version** (record the version in `docs/DECISIONS.md`). Exposed on `globalThis.azoo`:
```ts
azoo.version(): string
azoo.parse(src: string): { ok: true, scenario: ScenarioJSON } | { ok: false, errors: Err[] }
azoo.run(src: string, level: "RU"|"RC"|"SI"|"SER"): { ok: true, trace: Trace } | { ok: false, errors: Err[] }
azoo.runAll(src: string): { ok: true, traces: Record<Level, Trace> } | { ok: false, errors: Err[] }
// Err = { line: number, col: number, message: string }
```
Rules: calls are synchronous and **never throw** (all failures are data); inputs over limits are rejected before parsing; the Go program blocks forever after registering the functions (`select{}`).
**Worker protocol:** `web/public/engine/worker.js` (plain JS, same origin) loads `wasm_exec.js`, instantiates the module, then answers `{id, method, args}` with `{id, result}`. The main thread rejects any call that takes > 2000 ms, terminates the worker, and starts a fresh one.

### 5.10 CLI (`cmd/azoo`)
| Command | Purpose |
|---|---|
| `azoo run <file.azs> --level SER [--json]` | Run one scenario; human or JSON output |
| `azoo matrix scenarios/ [--check]` | Compute the full matrix; `--check` diffs against `scenarios/expected.json` and exits non-zero on any difference |
| `azoo traces --out web/public/traces` | Write `<scenario>.<level>.json` for every pair, plus `manifest.json` (ids, titles, digests). Stable ordering, no timestamps |
| `azoo gen --seed N --count M --level L [--txns 4] [--keys 5]` | Random schedule property run with oracle and shrinker; prints minimal `.azs` on failure |
| `azoo version` | Engine version |

---

## 6. Scenario catalog (exact sources and expected results)

All schedules are fixed and deterministic. Each `.azs` below is the **authoritative source**; copy verbatim into `scenarios/`. In the matrix, "occurs" means the invariant is violated.

### 6.1 Sources

**`dirty-read.azs`**
```
scenario dirty-read
title "Dirty Read: seeing a value that never existed"
story "T1 changes a price to 2 but has not committed. T2 reads the price. Then T1 changes its mind and aborts."
invariant "T2 only sees a committed price": b == 1
setup:
  PUT price = 1
schedule:
  T1 BEGIN
  T2 BEGIN
  T1 PUT price = 2
  T2 READ price AS b
  T1 ABORT
  T2 COMMIT
```

**`non-repeatable-read.azs`**
```
scenario non-repeatable-read
title "Non-Repeatable Read: the same question, two answers"
story "T1 reads Alice's balance twice. In between, T2 deposits money and commits."
invariant "T1 sees one balance for its whole transaction": first == second
setup:
  PUT balance:alice = 100
schedule:
  T1 BEGIN
  T2 BEGIN
  T1 READ balance:alice AS first
  T2 PUT balance:alice = 150
  T2 COMMIT
  T1 READ balance:alice AS second
  T1 COMMIT
```

**`phantom.azs`**
```
scenario phantom
title "Phantom: a row appears mid-transaction"
story "T1 counts the employees in a department twice. In between, T2 hires someone and commits."
invariant "T1's two counts agree": count(before) == count(after)
setup:
  PUT emp:1 = 1
  PUT emp:2 = 1
schedule:
  T1 BEGIN
  T2 BEGIN
  T1 SCAN emp: AS before
  T2 PUT emp:3 = 1
  T2 COMMIT
  T1 SCAN emp: AS after
  T1 COMMIT
```

**`lost-update.azs`**
```
scenario lost-update
title "Lost Update: two deposits, one survives"
story "T1 and T2 both read a balance of 100, then each adds a deposit (+50 and +30). Both read before either writes."
invariant "Every committed deposit is in the balance": final.val("balance") == 100 + 50 * committed(T1) + 30 * committed(T2)
setup:
  PUT balance = 100
schedule:
  T1 BEGIN
  T2 BEGIN
  T1 READ balance AS a
  T2 READ balance AS b
  T1 PUT balance = a + 50
  T2 PUT balance = b + 30
  T1 COMMIT
  T2 COMMIT
```

**`read-skew.azs`**
```
scenario read-skew
title "Read Skew: a total that does not add up"
story "Alice has 50 in checking and 50 in savings. T1 reads both to compute her total. In between, T2 moves 25 from checking to savings."
invariant "T1 computes a total of 100": checking + savings == 100
setup:
  PUT acct:checking = 50
  PUT acct:savings = 50
schedule:
  T1 BEGIN
  T2 BEGIN
  T1 READ acct:checking AS checking
  T2 PUT acct:checking = 25
  T2 PUT acct:savings = 75
  T2 COMMIT
  T1 READ acct:savings AS savings
  T1 COMMIT
```

**`write-skew.azs`**
```
scenario write-skew
title "Write Skew: the hospital with no doctor on call"
story "A hospital needs at least one doctor on call. Alice and Bob are both on call. Each checks that the other is on call, then goes off call."
invariant "At least one doctor stays on call": final.count("doctor:" WHERE == 1) >= 1
setup:
  PUT doctor:alice = 1
  PUT doctor:bob = 1
schedule:
  T1 BEGIN
  T2 BEGIN
  T1 SCAN doctor: WHERE == 1 AS on_t1
  T2 SCAN doctor: WHERE == 1 AS on_t2
  T1 NOTE "Two are on call, so Alice can leave."
  T2 NOTE "Two are on call, so Bob can leave."
  T1 PUT doctor:alice = 0
  T2 PUT doctor:bob = 0
  T1 COMMIT
  T2 COMMIT
```

**`read-only-anomaly.azs`**
```
scenario read-only-anomaly
title "Read-Only Anomaly: a report that can never be right"
story "A shop closes the day's batch and prints a report. A receipt that started before the close gets filed into the already-reported batch."
invariant "The printed report matches the batch's final total": sum(r) == final.sum("receipt:1:")
setup:
  PUT control:batch = 1
schedule:
  T2 BEGIN
  T3 BEGIN
  T2 READ control:batch AS current
  T3 READ control:batch AS before_close
  T3 PUT control:batch = before_close + 1
  T3 COMMIT
  T1 BEGIN
  T1 READ control:batch AS day
  T1 SCAN receipt:1: AS r
  T1 NOTE "Batch 1 is closed; its report shows no receipts."
  T1 COMMIT
  T2 PUT receipt:1:r1 = 100
  T2 COMMIT
```

**`deadlock.azs`** (bonus: not an isolation anomaly)
```
scenario deadlock
title "Deadlock: two transactions waiting on each other"
story "T1 locks a then wants b. T2 locks b then wants a. Neither can continue."
invariant "Both transactions complete": committed(T1) + committed(T2) == 2
setup:
  PUT a = 1
  PUT b = 1
schedule:
  T1 BEGIN
  T2 BEGIN
  T1 PUT a = 2
  T2 PUT b = 2
  T1 PUT b = 3
  T2 PUT a = 3
  T1 COMMIT
  T2 COMMIT
```

### 6.2 Expected matrix (`scenarios/expected.json` must encode exactly this)
`✗` = invariant violated ("occurs"); `✓` = holds ("prevented"). Mechanism = what prevented it.

| Scenario | RU | RC | SI | SER | Mechanism that prevents it |
|---|---|---|---|---|---|
| dirty-read | ✗ | ✓ | ✓ | ✓ | visibility (committed versions only) |
| non-repeatable-read | ✗ | ✗ | ✓ | ✓ | snapshot visibility |
| phantom | ✗ | ✗ | ✓ | ✓ | snapshot visibility |
| lost-update | ✗ | ✗ | ✓ | ✓ | abort `abort_concurrent_update` (first updater wins) |
| read-skew | ✗ | ✗ | ✓ | ✓ | snapshot visibility |
| write-skew | ✗ | ✗ | ✗ | ✓ | SER abort `abort_dependencies` |
| read-only-anomaly | ✗ | ✗ | ✗ | ✓ | SER abort `abort_dependencies` |
| deadlock | ✗ | ✗ | ✗ | ✗ | `abort_deadlock` at every level (not an isolation issue) |

Oracle verdict `serializable`: `false` in every ✗ cell **except `deadlock`** (the surviving history is serializable) and `true` in every ✓ cell. `expected.json` also records, per cell, which transaction aborted (if any) and the reason code, e.g. write-skew/SER → `T2: abort_dependencies`; lost-update/SI → `T2: abort_concurrent_update`; read-only-anomaly/SER → `T2: abort_dependencies` (at its `PUT receipt:1:r1` step); deadlock → `T2: abort_deadlock`.

### 6.3 Hand-verified walk-throughs (use as unit-test oracles)
- **lost-update @RC:** T1 holds `balance`; T2's PUT blocks on T1; T1 commits (`commitTS=2`); T2 resumes, writes `100+30=130` (stale read), commits → final 130, expected 180 ⇒ violated.
- **lost-update @SI:** same, but T2 resumes and finds newest committed `commitTS=2 > T2.snapshotTS=1` ⇒ `abort_concurrent_update`; final 150 = 100 + 50×1 + 30×0 ⇒ holds.
- **write-skew @SER:** edges `T2→T1` (T1 writes alice, T2 holds the `doctor:` prefix lock) and `T1→T2`. T1 commits (`commitTS=2`); the after-commit re-check finds T2 a pivot with committed `O=T1` ⇒ T2 doomed; T2's `COMMIT` aborts. Final: only alice off ⇒ count 1 ⇒ holds.
- **read-only-anomaly @SER:** clock: setup `1`, T3 commits `2`, T1 commits `3`. T2's snapshot is `1`. When T2 executes `PUT receipt:1:r1`, the edge `T1→T2` is added (T1 scanned the prefix; `T1.commitTS=3 > T2.snapshotTS=1`, so concurrent). T2 already has out-edge `T2→T3` (T3 wrote `control:batch` that T2 read). `O=T3` committed at 2, before T1 (3) and T2 (uncommitted) ⇒ T2 is a dangerous pivot and is the executing transaction ⇒ abort now.
- **deadlock:** T2's `PUT a` finds holder T1, which is waiting on T2 ⇒ cycle ⇒ T2 aborted; its release of `b` resumes T1's pending `PUT b=3`.

---

## 7. Frontend specification

### 7.1 Stack
Next.js (App Router) with `output: 'export'`, React 19, TypeScript (strict), Tailwind 4, no UI kit, no runtime dependency beyond React/Next (target ≤ 5 production deps). Node: current LTS [VERIFY at build time]. Self-hosted fonts (OFL-licensed files committed to the repo) or a system font stack; **no external font or script requests**.

### 7.2 Routes (all statically generated)
| Route | Content |
|---|---|
| `/` | Hero, **Habitat Map**, three-step "how it works", links to anomaly pages and playground, honest-limits blurb |
| `/anomalies/[slug]` | One page per scenario (8), `generateStaticParams` over the manifest |
| `/playground` | Editor + level tabs + results (loads WASM lazily) |
| `/about` | Methodology, limits, PostgreSQL conformance report, FAQ, links |
| `/og/[slug]` | Render target for OG screenshots; `noindex`; excluded from sitemap |
| `/404` | Friendly not-found |
Also generate `sitemap.xml` and `robots.txt` at build.

### 7.3 Habitat Map (home)
A grid: rows = anomalies, columns = 4 levels. Each cell shows **icon + text** (`✓ Prevented` / `✗ Occurs`), never color alone, plus the mechanism on hover/focus. The grid is built from `manifest.json` + trace summaries (**not hard-coded**). Click or Enter → `/anomalies/<slug>?level=<L>`. Mobile: rows become cards with four chips.

### 7.4 Anomaly page layout
1. Title, one-line hook, the story (from the scenario).
2. **Result banner** for the current level: e.g. "Write skew **occurs** at Snapshot Isolation: 0 doctors on call." / "**Prevented** at Serializable: T2 aborted (could not serialize access due to read/write dependencies)."
3. **Level switch** (segmented radio group: RU / RC / SI / SER) with a one-line definition of the selected level (§8.2).
4. **Timeline** (swimlane per transaction) + **Store panel** (version chains per key, snapshot markers) + **Explain panel** (plain-English sentence for the current event from reason codes).
5. **Step controls:** Back / Next / Play / Pause / Reset; keyboard `←` `→` `Space` `R`; shows "Step 5 of 11".
6. **Compare strip:** four mini timelines (one per level) at the same step, collapsible.
7. **Invariant badge** and **serializability verdict** with witness order when serializable.
8. "Why the levels differ" (§8) and "Run it yourself" → `/playground#s=<scenario source>`.
9. **PostgreSQL badge** per level: "Same outcome class as PostgreSQL ✓" from `conformance.json` (omit for RU: "PostgreSQL has no read-uncommitted").

### 7.5 Timeline rendering rules
- Time flows top → bottom; one column per transaction; sticky column headers.
- Each event is a card: op, args, result, status glyph. Blocked: dashed border + lock glyph + "waiting on T2". Aborted: ✕ + reason. Skipped: muted. Resumed events link visually to their original (same `scheduledIndex`).
- Transactions are distinguished by **color and glyph** (●, ■, ▲, ◆, ★, ⬟), never color alone.
- The current event is highlighted; later events are visible but dimmed ("future").
- **Mobile (< 640 px):** a single chronological list; each card carries a T-label chip; the store panel becomes a collapsible drawer.
- Animations ≤ 200 ms; disabled under `prefers-reduced-motion`.

### 7.6 Playground
- `<textarea>` editor (monospace, line numbers via CSS counters), a **Load example** menu (the 8 scenarios), **Run** (`Ctrl/Cmd+Enter`), and a **Share** button.
- Errors list under the editor with line:col; clicking focuses the line.
- Result: tabs RU / RC / SI / SER (or the compare grid), each rendering the same Timeline/Store/Explain components from a trace. If the scenario has no invariants, show the **oracle verdict** and, when not serializable, the sentence "No serial order of the committed transactions produces these reads and this final state."
- **Share link:** `#s=<base64url(UTF-8 source)>`; refuse links > 4 KB; on load, parse and validate before running; on failure show an inline error, never a blank page.
- A tiny "Re-run in your browser" action on anomaly pages loads WASM, re-runs the scenario, and confirms `digest` equals the shipped static trace ("✓ identical to the published trace").

### 7.7 State and URL
URL is the source of truth: `?level=SI&step=5` on anomaly pages; `#s=…` on the playground. Read in `useEffect` to stay SSR-safe. Unknown or invalid params are ignored (defaults apply). Every interactive control updates the URL with `history.replaceState`.

### 7.8 Accessibility (WCAG 2.2 AA)
Landmarks and one `<h1>` per page; level switch is a `radiogroup` with arrow-key navigation; step controls are real `<button>`s with accessible names; the explain panel is `aria-live="polite"` and announces the current event; focus ring always visible; contrast ≥ 4.5:1 in both light and dark themes; touch targets ≥ 44 px; the page works at 200 % zoom and 320 px width; `axe` has zero serious/critical violations on every route (§9.6).

### 7.9 Visual design direction
A restrained "specimen museum" feel: calm neutral surfaces, one accent, monospace for keys/values, clear type hierarchy, small "specimen label" cards for each anomaly. Light and dark via CSS variables and `prefers-color-scheme`, with a manual toggle stored in `localStorage` (wrapped in try/catch; page must render correctly without it). Avoid template-looking gradients and stock illustrations. Provide a 1200×630 OG image per anomaly (`public/og/<slug>.png`, ≤ 100 KB each).

### 7.10 Performance
Static trace JSON per scenario/level ≤ 20 KB (minified, gzip smaller). Home loads only `manifest.json` and a matrix summary (≤ 10 KB). WASM is fetched only on `/playground` or when "Re-run" is clicked, after idle. Use `Cache-Control: public, max-age=31536000, immutable` for content-hashed files.

---

## 8. Content and copy requirements

### 8.1 Page template (each anomaly)
Hook (≤ 12 words) → Story (from the scenario, ≤ 3 sentences) → Interactive run → "What went wrong / what was prevented" (generated from the trace, not hand-written) → "Why the levels differ" (§8.3) → "In practice" (§8.4) → "Run it yourself" link.

### 8.2 One-line level definitions (shown beside the level switch)
- **Read Uncommitted (RU):** "Reads whatever is newest, even if its writer has not committed. Included to show dirty reads; most databases do not offer it."
- **Read Committed (RC):** "Each statement sees what was committed when that statement started."
- **Snapshot Isolation (SI):** "The whole transaction sees the database as of its first read or write. If two transactions write the same row, the first to get there wins and the other aborts."
- **Serializable (SER):** "Snapshot isolation plus detection of dangerous read→write patterns. Some transactions abort so the result always matches running them one at a time."
- Footnote (verify before publishing): "In PostgreSQL, Read Committed, Repeatable Read, and Serializable correspond to RC, SI, and SER here." [VERIFY]

### 8.3 "Why the levels differ" (one or two sentences each)
| Scenario | Copy |
|---|---|
| dirty-read | RU reads the newest version even if uncommitted; every other level only reads committed versions. |
| non-repeatable-read | RC takes a fresh view for every statement, so a later read can differ. SI and SER keep one snapshot for the whole transaction. |
| phantom | Same mechanism as above, applied to a set of rows: under RC the new row shows up; under a snapshot it stays hidden. |
| lost-update | At RC both transactions write values computed from a stale read, so the second overwrites the first. SI and SER notice that the row changed after the snapshot and abort the second writer, which then retries. |
| read-skew | At RC the two reads happen at different moments and see different states. A snapshot gives both reads one consistent state. |
| write-skew | The two transactions write **different** rows, so SI sees no conflict, yet each decision depended on a read the other one invalidated. SER tracks those read→write dependencies and aborts one transaction. |
| read-only-anomaly | Even a transaction that only reads can observe a state no serial order explains. SER detects the dangerous pattern across three transactions and aborts the one that completes the cycle. |
| deadlock | Not an isolation problem. Two transactions wait for each other's locks; the database aborts one. |

### 8.4 "In practice" block (general guidance, not vendor claims)
Use real mitigations, phrased generally: retry on serialization failures; prefer atomic updates (`SET v = v + 50`) to read-modify-write; add constraints or unique indexes; take explicit locks when needed; choose the weakest level that is correct and test it. Close with: "Check your own database's documentation: behavior differs between vendors and versions." Illustrative scenarios (on-call roster, double-booked room, inventory counter) must be labelled as illustrations, not incident reports.

### 8.5 Tone
Plain, curious, precise, no hype. Define a term the first time it appears. Never say "always" or "never" about real databases.

---

## 9. Verification strategy

### 9.1 Overview and targets
| Layer | What | Target (PR CI unless noted) |
|---|---|---|
| Unit | mvcc visibility, locks, deadlock, SSI edges and dangerous check, DSL lexer/parser/expr/validate, oracle | ≥ 80 tests; ≥ 85 % line coverage on `engine/...` |
| Golden | 8 scenarios × 4 levels trace files | byte-exact match in `engine/testdata/golden/` |
| Matrix | `azoo matrix --check` vs `expected.json` | exact match |
| Property | random schedules vs invariants and oracle (§9.3) | 20 000 schedules per level; **nightly 200 000** |
| Cross-platform | golden traces identical native vs `GOOS=js GOARCH=wasm` under Node | digests equal |
| Conformance | schedules vs real PostgreSQL (§9.4) | canned all + 500 random per level; **nightly 10 000** |
| Fuzz | parser and runner (§9.5) | 30 s each; **nightly 5 min each** |
| Web unit | explain mapping, URL state, share codec, matrix builder | Vitest |
| E2E | journeys J1–J4, CSP, keyboard-only | Playwright: Chromium, Firefox, WebKit |
| A11y / perf | axe, Lighthouse CI, size gates | zero serious axe issues; budgets in §3.7 |

Targets are minimums to aim at, not claims to publish. Publish only measured numbers.

### 9.2 Golden traces and the matrix
Golden files are updated only with an explicit `-update` flag and the diff is reviewed. CI fails on any difference. `azoo matrix --check` fails if any cell, mechanism, aborted transaction, reason code, or oracle verdict differs from `expected.json` (§6.2). The web app consumes **generated** traces; there must be no hard-coded outcomes anywhere in `web/` (a unit test builds the map from fixture traces and a lint rule bans literal outcome strings in components).

### 9.3 Property-based testing
**Generator** (deterministic from `--seed`, using a stdlib PRNG with fixed algorithm):
- 2–4 transactions; 3–8 ops each; keys drawn from `p:1 p:2 p:3 q:1 q:2`; scans over `p:` or `q:`.
- Op mix ≈ READ 25 %, SCAN 15 %, PUT const 25 %, PUT `var±int` 20 % (variable bound earlier by the same transaction), DELETE 5 %, remainder extra READs.
- Each transaction ends `COMMIT` 80 % / `ABORT` 20 %; interleaving is a random shuffle that preserves per-transaction order; random setup values for 3 of the keys.

**Properties**
| # | Levels | Property |
|---|---|---|
| P1 | all | Terminates, no panic, trace validates against the JSON Schema, digest is stable across two runs |
| P2 | all | Store invariants: chains ordered; ≤ 1 uncommitted version per key and it is last; none remain at the end; locks empty at the end; `clock == commits + 1` |
| P3 | RC, SI, SER | **No dirty reads:** every value read is a setup value, the reader's own write, or a version whose writer committed at or before the read's statement time |
| P4 | SI, SER | **Repeatable reads:** the same key (or prefix scan) read twice with no own write in between returns identical results |
| P5 | SI, SER | **No lost updates:** no two **concurrent** committed transactions share a written key |
| P6 | SER | **Serializability:** the oracle accepts every history of committed transactions |
| P7 | SI, RC | **Vacuity guards:** among ≥ 20 000 schedules, SI yields ≥ 1 non-serializable history and RC yields ≥ 1 non-repeatable read; otherwise the generator or oracle is broken |
| P8 | all | Native and WASM digests agree on the canned scenarios |

On any failure the shrinker prints a minimal `.azs`; save it under `engine/testdata/regressions/` and keep it forever.
**P6 is the headline guarantee.** If the oracle ever rejects a SER history, treat it as a P0 bug in SSI, not a flaky test.

### 9.4 Conformance against real PostgreSQL (`conformance/`, separate Go module)
**Purpose:** show with data how closely the engine's outcomes match a real database, and surface where they differ.

**Setup:** GitHub Actions `services: postgres` using the official image pinned to a specific major version [VERIFY current stable major; fall back to the preinstalled server on the Ubuntu runner if image pulls are rate-limited]. Driver `pgx/v5`. One connection per transaction, each in its own goroutine, driven by a single orchestrator that mirrors the schedule order.

**DSL → SQL** (table `kv(k text primary key, v bigint not null)`, truncated per run; setup committed first):
| DSL | SQL |
|---|---|
| `BEGIN` at level L | `BEGIN ISOLATION LEVEL {READ COMMITTED \| REPEATABLE READ \| SERIALIZABLE}`; also `SET LOCAL lock_timeout='5s'`; session `SET deadlock_timeout='100ms'` |
| `READ k` | `SELECT v FROM kv WHERE k = $1` |
| `SCAN p [WHERE op n]` | `SELECT k, v FROM kv WHERE starts_with(k, $1) [AND v op $2] ORDER BY k` |
| `PUT k = e` | `INSERT INTO kv(k,v) VALUES($1,$2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v` |
| `DELETE k` | `DELETE FROM kv WHERE k = $1` |
| `COMMIT` / `ABORT` | `COMMIT` / `ROLLBACK` |

(`starts_with` avoids LIKE wildcard issues with `_`.) Keys stay within `[a-z0-9:._-]`.

**Blocked statements:** run each statement with a goroutine; if it has not returned after 200 ms **and** `pg_stat_activity.wait_event_type = 'Lock'` for that backend, mark it blocked and continue the schedule; after any commit/abort wait up to 2 s for newly unblocked statements. Map SQLSTATE `40001` → serialization abort, `40P01` → deadlock; after any error issue `ROLLBACK`, mark the transaction aborted, and skip its remaining steps (same rule as the engine).

**Scope:** compare **RC, SI, SER only** (PostgreSQL has no true read-uncommitted [VERIFY]). No `DELETE` in the first random corpus; add it later only after the base comparison is clean.

**What is compared**
- **RC and SI:** per-statement results, final state, and the set of aborted transactions must be **identical**.
- **SER:** PostgreSQL's SSI uses finer-grained predicate locks and optimisations my SSI-lite does not, so abort sets can differ. Report: (a) both histories serializable per the oracle (must be 100 % for both), (b) % of schedules with identical abort sets, (c) % where the engine aborts more than PostgreSQL, (d) % where it aborts fewer (investigate every case; fewer aborts must still be serializable).
- **Deadlock schedules:** compare outcome class only (someone aborts with a deadlock); the victim may differ.

**Output:** `web/public/conformance.json` with `engineVersion`, `postgresVersion`, per-canned-scenario comparison, random-run totals per level, and `knownDivergences` (each with a plain-English cause and a regression schedule). Every mismatch must end as either an engine fix or a documented divergence in `docs/METHODOLOGY.md`. The About page renders this file; the CI release check fails if its `engineVersion` differs from the engine's.

### 9.5 Fuzzing
- `FuzzParse`: arbitrary bytes never panic or hang; if parsing succeeds then `Format(Parse(x))` re-parses to an equal AST (requires a canonical `Format` printer).
- `FuzzRun`: for any input that parses, running all four levels terminates, never panics, emits a schema-valid trace, and gives the same digest on a second run.
- Add seeds from every scenario and regression. Go stores failing inputs under `testdata/fuzz/`; commit them.

### 9.6 Web tests
- **Vitest:** explain-text mapping for every reason code, URL-state parser, share codec (round-trip, oversize, garbage input), matrix builder from fixture traces.
- **Playwright** (served by a small Node static server that applies the headers from `vercel.json`, so the real CSP is tested): J1 step through an anomaly and switch level; J2 click a matrix cell; J3 playground run, parse-error display, share-link round trip, rejection of a > 4 KB link and of a malformed link; J4 About page numbers equal `conformance.json`; **CSP test** fails on any `securitypolicyviolation` event or CSP console error across all routes, including worker + WASM load; **keyboard-only** walk-through of J1.
- **axe** (`@axe-core/playwright`) on every route in light and dark: zero serious/critical violations.
- **Lighthouse CI:** mobile profile on `/` and one anomaly page; budgets: performance ≥ 90, accessibility ≥ 95, best-practices ≥ 95, SEO ≥ 95 (tune after the first measured baseline and record in `docs/DECISIONS.md`).
- **Size gates** (`web/scripts/size-gate.mjs`): fail if first-load JS on `/` > 150 KB gzip, any trace > 20 KB, or WASM gzip > 1.5 MB (target ≤ 1.0 MB).

---

## 10. Security and hardening

### 10.1 Threat model
The site is static and client-side only: no accounts, no stored data, no server code. Realistic risks:
| Threat | Vector | Control |
|---|---|---|
| XSS | Attacker-crafted playground share link (`#s=`), DSL strings (title, story, NOTE) rendered in the page | Render everything as React text nodes; **never** `dangerouslySetInnerHTML`, `innerHTML`, or `eval`; validate before running; strict CSP |
| Resource exhaustion | Huge or pathological DSL | Hard limits (§4.10), parser fuzzing, 2 s worker timeout with terminate/restart, no recursion without depth limits |
| Supply chain | Malicious npm/Go/Actions dependency | Minimal deps, lockfiles, `--ignore-scripts`, pinned Actions, Dependabot, vulnerability scans |
| Tampered release | Deployed WASM differs from source | Reproducible WASM build + committed hash checked in CI |
| Clickjacking | Embedding the site | `frame-ancestors 'none'` |
| Privacy leak | Third-party requests, trackers | None allowed; CSP `connect-src 'self'`, self-hosted fonts |
| Account takeover | Maintainer's GitHub/Vercel accounts | 2FA on both, branch protection, no long-lived tokens |

### 10.2 Response headers (`web/vercel.json`)
```json
{
  "headers": [
    { "source": "/(.*)", "headers": [
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "no-referrer" },
      { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
      { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
      { "key": "Content-Security-Policy", "value": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'none'" }
    ]},
    { "source": "/engine/(.*)", "headers": [
      { "key": "Content-Security-Policy", "value": "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'" },
      { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
    ]},
    { "source": "/_next/static/(.*)", "headers": [
      { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
    ]}
  ]
}
```
`/engine/engine.json` must override the immutable rule with `Cache-Control: no-cache` (add a more specific header block placed **after** the generic one and verify precedence in P0). Whether Vercel adds HSTS on its own domains: [VERIFY]; do not add `preload`.

### 10.3 Per-page CSP (static export has no server)
A post-build script `web/scripts/inject-csp.mjs` scans every `out/**/*.html`, computes SHA-256 hashes of each inline `<script>` (excluding `application/json` data blocks), and inserts:
```
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'sha256-…' 'sha256-…'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'none'">
```
- Pages do **not** get `'wasm-unsafe-eval'` (WASM runs only in the worker, whose own CSP comes from its response headers; the worker-script-header-governs-worker-CSP behavior is [VERIFY] in P0 on Chromium, Firefox, and WebKit).
- `style-src 'unsafe-inline'` is accepted for React-rendered style attributes because scripts are hash-locked; remove it if the UI can avoid inline style attributes entirely.
- **If this approach proves brittle in P0**, switch the web app to a Vite static SPA (no inline scripts, strict header CSP) and record the change in `docs/DECISIONS.md`.

### 10.4 Input handling rules
- Share links: reject > 4 KB; decode with strict base64url; reject invalid UTF-8; then apply source limits (8 KB, 6 transactions, 200 steps, 64 keys) and parse with the hardened parser.
- Titles, stories, and notes are plain text; strip control characters; cap lengths (title 80, story 400, note 120, invariant name 80).
- Ignore unknown query/hash parameters. Never reflect input into `<title>`, meta tags, or URLs.
- No `localStorage` dependence for correctness; wrap all storage access in try/catch.

### 10.5 Supply chain and repo hygiene
- **Go:** engine uses the standard library only. `conformance/` is a separate module that may use `pgx/v5` (record exact version and license [VERIFY MIT]). Pin the toolchain in `go.mod` (`toolchain` line). Run `govulncheck ./...` in CI.
- **npm:** `.npmrc` with `ignore-scripts=true` and `save-exact=true`; `npm ci` only; ≤ 5 production dependencies; `npm audit --omit=dev --audit-level=high` blocks merges.
- **GitHub Actions:** every `uses:` pinned to a full commit SHA with a version comment; default workflow `permissions: {}` and per-job least privilege (`contents: read`); trigger on `pull_request`, never `pull_request_target`; no secrets in workflows (deployment uses the Vercel Git integration, which needs no token in CI).
- **Dependabot** for `gomod`, `npm`, and `github-actions`, weekly.
- **CodeQL** (Go and JavaScript/TypeScript) on PRs and weekly; free for public repositories.
- **Branch protection on `main`:** required status checks (§11.1), linear history, no force-push, PRs required.
- **Accounts:** 2FA on GitHub and Vercel; nothing sensitive is stored anywhere in this project.
- **`SECURITY.md`:** how to report vulnerabilities (GitHub private vulnerability reporting), supported versions, expected response window (state a modest one you can keep).
- **Licenses:** MIT for the project; `THIRD_PARTY_NOTICES.md` generated for shipped dependencies and fonts.

### 10.6 Privacy
No cookies, no analytics, no third-party requests, no fingerprinting. The About page says exactly that. Measure reach with GitHub Traffic and social-platform stats only.

---

## 11. CI/CD and deployment (free tools only)

### 11.1 GitHub Actions workflows
| Workflow | Trigger | Jobs |
|---|---|---|
| `ci.yml` | PR, push to `main` | **go:** `gofmt -l`, `go vet`, `staticcheck`, `go test -race -count=1 ./...`, coverage gate, `azoo matrix --check`, golden diff, property tests (20k/level). **wasm:** build, size gate, reproducibility hash check, native-vs-WASM digest test under Node. **web:** `npm ci`, lint, typecheck, Vitest, `next build`, CSP injection, size gates. **e2e:** Playwright (3 browsers) + axe + Lighthouse CI against the built `out/` with real headers. **security:** `govulncheck`, `npm audit` |
| `conformance.yml` | PR touching `engine/` or `scenarios/`, nightly, manual | Postgres service container; canned + 500 random (PR) or 10 000 random (nightly); uploads `conformance.json` as an artifact |
| `fuzz.yml` | nightly, manual | 5 min per fuzz target; 200 000 property schedules per level |
| `codeql.yml` | PR, weekly | Go, JS/TS |
Required checks for merging `main`: `go`, `wasm`, `web`, `e2e`, `security`, and `conformance` (when triggered).
Use only standard (2-core) hosted runners, since larger runners are billed even on public repos.

### 11.2 One-time setup (all free, no card)
1. Create the public GitHub repo `Aditya-tec/anomaly-zoo` (MIT). Enable 2FA, branch protection, Dependabot, CodeQL, and private vulnerability reporting.
2. Sign in to Vercel with GitHub on the **Hobby** plan (no card). Import the repo with **Root Directory `web`**, framework preset **Next.js**, install command `npm ci --ignore-scripts`, build command `npm run build` (runs `next build` then `inject-csp.mjs` and `gen-sitemap.mjs`), Node version set to the current LTS [VERIFY the Vercel dropdown]. Confirm that a static-export build is served from `out/` [VERIFY in P0]. Add **no environment variables** and **do not enable** Web Analytics or Speed Insights.
3. Choose a project name so the URL is `anomaly-zoo.vercel.app` if free; otherwise pick another and record it in the README. A custom domain costs money and is out of scope.
4. The built WASM is **committed** (reproducibility-checked in CI), so Vercel does not need a Go toolchain.
5. Enable PR preview deployments (default). Keep the site non-commercial: no ads, payment links, affiliate links, or sponsorship prompts on the site (Vercel Hobby terms).
6. **Fallback host (document, do not enable by default):** a GitHub Pages workflow that publishes `web/out`. Note that Pages cannot send custom headers, so only the per-page meta CSP applies and `frame-ancestors` cannot be set.

### 11.3 Reproducible WASM and engine manifest
- Build with `CGO_ENABLED=0 GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w -buildid=" -o … ./cmd/wasm`, with the Go toolchain pinned in `go.mod`.
- `make wasm` writes `web/public/engine/azoo.<hash8>.wasm`, copies `wasm_exec.js` from the same toolchain, and writes `web/public/engine/engine.json` (`{engineVersion, goVersion, wasm, wasmSha256, wasmExec}`).
- CI rebuilds from source and **fails if the SHA-256 differs from the committed one**. The About page prints the hash so anyone can verify the deployed binary.
- The worker fetches `engine.json` (no-cache) and then the hashed WASM file (immutable).

### 11.4 Makefile targets
`make test` · `make matrix` · `make traces` · `make wasm` · `make web` · `make e2e` · `make conformance` (needs Docker) · `make fuzz` · `make all`.

### 11.5 Release and rollback
- **Release checklist** (all must pass before announcing): every AC in §12 ticked; Lighthouse and size gates green; CSP smoke test clean on all routes; `conformance.json` regenerated for the current engine version; README hero GIF recorded; METHODOLOGY and limits pages final; OG images present; `SECURITY.md` and LICENSE present; repo description and topics set; **re-verify free-tier terms** (Vercel Hobby non-commercial clause and limits, GitHub Actions public-repo minutes, GitHub Pages limits if the fallback is used) and record the date in `docs/DECISIONS.md`.
- **Rollback:** redeploy or promote the previous Vercel deployment from the dashboard [VERIFY availability on Hobby], or `git revert` the bad commit on `main`. Because there is no backend or data, rollback is always safe.
- **Versioning:** SemVer for the engine, changelog in `CHANGELOG.md`, tag `v1.0.0` at launch.

---

## 12. Phased build plan (with acceptance criteria)

Sizes: S ≈ a few hours of agent work, M ≈ a day, L ≈ 1–2 days. They are rough guides only. Track progress in `docs/PROGRESS.md` (one checkbox per AC). **Do not skip a gate.**

### P0 — Spike and gates (S)
Scaffold the repo (§3.5), Makefile, CI skeleton, `docs/`. Build a trivial Go→WASM module with a worker; deploy a hello page to Vercel; prove headers, CSP, and the Postgres service container.
- AC0.1 WASM hello builds; gzip size recorded in `docs/DECISIONS.md`; ≤ 1.5 MB gzip (target ≤ 1.0 MB).
- AC0.2 On a Vercel preview, the worker instantiates the WASM under the §10.2/§10.3 headers in Chromium, Firefox, and WebKit with **zero CSP violations**.
- AC0.3 The Next static export gets a working per-page meta CSP (hash injection) with no violations; if not, switch to Vite SPA and record why.
- AC0.4 `curl -I` confirms `/engine/engine.json` is `no-cache` while hashed engine files are immutable.
- AC0.5 CI Postgres service container accepts a `SELECT 1` from the `conformance` module.
- AC0.6 Free-tier terms re-verified (§2) and dated in `docs/DECISIONS.md`.
- **Gate:** if AC0.1 or AC0.2 fails, **stop and report the data to the owner** (candidate fallbacks: TinyGo, or a TypeScript engine with a Node-based conformance harness). Do not improvise.

### P1 — DSL (S)
Lexer, parser, validator, expression evaluator, invariant evaluator, canonical `Format` printer, limits (§4.10, §5.3). Commit the 8 scenario sources (§6.1).
- AC1.1 All 8 scenarios parse and `Format(Parse(x))` round-trips.
- AC1.2 Errors carry `line`, `col`, and clear messages; ≤ 20 reported; every validation rule in §4.10 and §5.3 has a test (≥ 30 parser tests).
- AC1.3 `FuzzParse` runs 5 minutes with no panic or hang; seeds committed.

### P2 — Engine core: RU and RC (M)
MVCC store, visibility (§4.4), write locks, blocking, runner and wake loop (§4.11), deadlock detection, trace types and JSON Schema, canonical JSON and digest, golden-trace harness.
- AC2.1 Hand-verified traces for the §6.3 cases at RU/RC: lost-update@RC final = 130; dirty-read@RU reads 2; deadlock aborts T2 and resumes T1.
- AC2.2 The RU and RC columns of the matrix equal `expected.json`.
- AC2.3 Every trace validates against `trace.schema.json`; two runs give identical digests.
- AC2.4 Unit tests cover visibility, lock handoff, FIFO wake order, queued steps behind a blocked statement, deadlock, and `blocked_at_end`; ≥ 85 % coverage on `engine/mvcc`, `engine/txn`, `engine/run`.

### P3 — Snapshot isolation (S)
Snapshot at first data operation, SI visibility, first-updater-wins at lock acquisition (immediate and after waiting).
- AC3.1 SI column of the matrix equals `expected.json`; lost-update@SI aborts T2 with `abort_concurrent_update` and final = 150.
- AC3.2 Property tests P1–P5 pass at SI for 20 000 schedules; P7 vacuity guard finds a non-serializable SI history.

### P4 — SSI and the oracle (L)
SIREAD tracking, rw edges, dangerous-structure check, doom logic (§4.8), oracle and shrinker (§5.5).
- AC4.1 SER column equals `expected.json`; the §6.3 walk-throughs for write-skew and read-only-anomaly reproduce exactly (edges, victim, step).
- AC4.2 P6 (oracle accepts every SER history) passes for 20 000 schedules in CI and **200 000 once, run locally and recorded** in `docs/PROGRESS.md`.
- AC4.3 **Mutation checks:** temporarily disabling each of {edge rule 1, rule 2, rule 3, dangerous check at commit, after-commit re-check} makes at least one test fail, and the shrinker prints a minimal schedule (≤ 8 steps) for at least one of them. Keep these as an automated test using build tags or injectable fault switches.
- AC4.4 Oracle unit tests include known non-serializable histories (write skew, read-only anomaly) and serializable ones.

### P5 — CLI, traces, WASM (S)
`azoo run|matrix|traces|gen|version`, trace generation with manifest, WASM build with worker, reproducible build and hash check (§11.3), size gate.
- AC5.1 `azoo matrix --check` passes in CI; each trace ≤ 20 KB.
- AC5.2 Native and WASM digests are identical for all 32 canned traces (run under Node).
- AC5.3 The worker returns structured errors for invalid input and is terminated and restarted after a 2 s timeout (test with a stub that sleeps).
- AC5.4 CI rebuild reproduces the committed WASM hash.

### P6 — Web: map and anomaly pages (L)
Layout, theme, Habitat Map, anomaly pages from static traces, Timeline, Store panel, Explain panel, level switch, step controls, compare strip, result banners, PostgreSQL badge placeholder (hidden until P8), About page skeleton.
- AC6.1 Every route builds statically; the map and banners are generated from traces (no hard-coded outcomes; lint rule and unit test).
- AC6.2 J1/J2 e2e pass in three browsers; keyboard-only walk-through passes.
- AC6.3 Works from 320 px to 1440 px; reduced-motion respected; light and dark themes.
- AC6.4 axe: zero serious/critical issues on all routes; Lighthouse and size budgets green; CSP smoke test clean.

### P7 — Playground (M)
Editor, examples, run-all-levels, error list, share links, limits, WASM lazy-load, "Re-run in your browser" digest check.
- AC7.1 J3 e2e passes (run, error display, share round trip, oversize/garbage link rejection).
- AC7.2 The home page and anomaly pages do **not** request the WASM file until the user opts in (network assertion).
- AC7.3 Playground with no invariants shows the oracle verdict and, when false, the explanatory sentence (§7.6).
- AC7.4 No use of `innerHTML`/`dangerouslySetInnerHTML` anywhere (lint-enforced); a share link containing `<script>` or HTML in title/story/note renders as inert text (test).

### P8 — PostgreSQL conformance (L)
Build the harness (§9.4); run canned scenarios, then 500 random schedules per level; investigate every mismatch; publish `conformance.json`; wire the About page and the PostgreSQL badges.
- AC8.1 Harness runs in CI against the service container and produces `conformance.json` with `engineVersion` and `postgresVersion`.
- AC8.2 Canned scenarios: the "occurs/prevented" class matches PostgreSQL for RC, SI, and SER, or the difference is documented.
- AC8.3 Random corpus at RC and SI: 100 % identical, **or** every difference is an engine fix or a `knownDivergences` entry with a regression schedule.
- AC8.4 SER: 100 % of both histories serializable per the oracle; abort-set statistics reported honestly (§9.4).
- AC8.5 A nightly run of 10 000 random schedules per level completes once; results are recorded in `docs/PROGRESS.md`.
- **Timebox:** if a mismatch cannot be explained within a few hours, record it as a divergence with a minimal schedule and move on.

### P9 — Hardening and QA (M)
Everything in §10, full e2e matrix, 1-hour fuzz run, dependency and Actions audit, `SECURITY.md`, `THIRD_PARTY_NOTICES.md`.
- AC9.1 §10.5 checklist items all done and verifiable in the repo settings or CI.
- AC9.2 One 60-minute fuzz run per target with no findings (or fixed findings with regression seeds).
- AC9.3 `npm audit` (high+) and `govulncheck` clean; Actions pinned by SHA; Dependabot active; CodeQL green.
- AC9.4 No console errors or CSP violations on any route in three browsers.

### P10 — Deploy and launch prep (S)
Production deploy, OG images, sitemap, README, METHODOLOGY, release checklist (§11.5), launch assets (§13.1).
- AC10.1 Production URL live over HTTPS; headers verified with `curl -I`; Lighthouse budgets met on the production URL.
- AC10.2 README, METHODOLOGY (incl. limits and known divergences), OG images, sitemap present; tag `v1.0.0`.
- AC10.3 Free-tier terms re-verified and dated.
- AC10.4 Launch assets drafted (recording, matrix image, README GIF, post outlines filled with **measured** numbers only).

### Suggested order and cut list
Engine first (P0–P5), then web (P6–P7), then conformance (P8), then hardening and launch (P9–P10). If time is short, cut in this order: compare strip → OG images → light/dark toggle (keep `prefers-color-scheme`) → playground examples beyond the 8 → deadlock page. **Do not cut P8 (conformance), P4's oracle, or P9's security items**: they are what make the project credible. Do not publish any PostgreSQL-comparison claim before P8 is finished.

---

## 13. Launch plan

### 13.1 Assets to prepare
1. A 20–30 s screen recording of **write skew**: run at SI (0 doctors on call) → flip to SER → T2 aborts → invariant holds. No narration needed; add burned-in captions.
2. The Habitat Map screenshot (clean, light and dark).
3. A short "how it is verified" diagram: engine → oracle on random schedules; engine ↔ PostgreSQL on shared schedules (with the measured numbers).
4. README hero GIF (≤ 5 MB) and the same clip as MP4.
5. Three stills for a carousel: the bug, the fix, the proof.

### 13.2 Post outlines (fill in only with measured facts)
- **LinkedIn:** hook ("Two doctors go off call at the same time. Your transaction just broke the hospital's one rule.") → what it is in two sentences → what is different (built from scratch in Go, runs in your browser, outcomes checked against PostgreSQL on N random schedules) → one honest limit → link → a question inviting people to share the worst concurrency bug they have seen.
- **X thread (6 posts):** 1 hook + video; 2 the matrix image; 3 how the engine works (snapshots, lock waits, dependency tracking) with one diagram; 4 how it is verified (oracle and PostgreSQL numbers); 5 what is simplified or wrong (limits); 6 link, repo, and ask for feedback.
- **Show HN:** title "Show HN: Anomaly Zoo – watch database isolation anomalies happen, step by step". First comment: motivation, what is verified and how, the limits, and an invitation to try to break it. Check Hacker News's current guidelines before posting [VERIFY]; never ask for upvotes.
- **Subreddits** (for example r/PostgreSQL, r/programming): read each community's self-promotion rules first [VERIFY], post only where allowed, and do not cross-post everywhere on the same day.
- **Optional write-up** on a free blogging platform: "What I learned building MVCC and SSI from scratch", featuring the most surprising conformance finding **if one exists**.

### 13.3 Claims policy
**You may say** (each only if true when published):
- "A from-scratch MVCC engine in Go (standard library only)."
- "Four isolation levels, eight scenarios; the matrix is computed by running the engine and asserted in CI."
- "The Serializable level was checked against a serializability oracle on N random schedules with 0 violations." (use the real N)
- "Outcomes were compared with PostgreSQL <version> on N random schedules: X % identical at Read Committed and Repeatable Read; differences are documented." (use the real numbers)
- "Runs entirely in your browser; no backend, no tracking."

**You may not say:**
- "First", "only", or "the best" interactive isolation explainer.
- "Matches PostgreSQL exactly", "production-ready", or "a real database".
- "Fully implements SSI" or "proves Serializable is correct". Say "passed N random schedules against an oracle".
- Anything about MySQL, Oracle, or SQL Server behavior.
- Any figure not backed by `conformance.json` or a recorded test run.

**Limits to state on the About page:**
1. Key–integer model with prefix scans; no SQL, indexes, or durability.
2. A deterministic single-threaded simulation of interleavings, not real concurrency.
3. Read Uncommitted is included for teaching; PostgreSQL has no equivalent [VERIFY].
4. SSI-lite uses prefix-level predicate locks and has no read-only optimization, so it can abort more transactions than PostgreSQL; the conformance report quantifies this.
5. Vendor behaviors differ; this explains concepts and does not replace your database's documentation.

### 13.4 Sequence
- **Pre-launch review:** send the preview link to 3–5 engineers (including the friend who reviewed OfflinePDF) and fix every point of confusion they report.
- **Day 0:** LinkedIn + X thread; Show HN on a weekday morning in a US time zone; stay online to answer comments for the first hours.
- **Days 1–2:** reply to every comment; collect bug reports; ship fixes quickly and say so publicly.
- **Day 3:** follow-up post on one concrete learning (a surprising divergence, a mutation-test find, a shrunk minimal counterexample).
- **Day 7:** short retrospective with real numbers (stars, traffic, issues, inbound messages).
- **Log:** every inbound message from a founder/CTO/recruiter in a private note; reply within a day.

---

## 14. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Go WASM too large or slow | Low–medium | P0 gate; budgets; stdlib-only code; fall back per owner decision |
| CSP + Next static export brittle | Medium | P0 gate AC0.3; Vite SPA fallback |
| SSI-lite subtle bug | Medium | Oracle, mutation checks, shrinker, 200k schedule run |
| PostgreSQL mismatches consume time | Medium–high | Timebox; document divergences with minimal schedules; compare outcome classes for SER |
| Perceived as "just another explainer" | Medium | Lead with "built from scratch + verified against PostgreSQL + runs in your browser", and state limits openly |
| Vercel Hobby non-commercial terms | Low | Keep the site free of ads, payments, affiliate links; GitHub Pages fallback |
| Free-tier terms change | Low–medium | Re-verify at P0 and P10; static output is portable to any static host |
| Time pressure from work and the new job | Medium | Cut list (§12); ship at P7 + P9 + P10 minimum, with P8 strongly preferred |

---

## 15. Open decisions (defaults apply unless the owner overrides)

1. **Engine language:** Go (default, subject to the P0 gate).
2. **Include Read Uncommitted in the matrix:** yes, labelled as teaching-only.
3. **Include the deadlock bonus page:** yes.
4. **Repository and site name:** `anomaly-zoo`.
5. **PostgreSQL major version for conformance:** the current stable major at P0 [VERIFY]; record it.
6. **License:** MIT.
7. **Hosting:** Vercel Hobby, GitHub Pages as documented fallback.

---

## Appendix A — `scenarios/expected.json` (authoritative)

`aborts` lists **engine-initiated** aborts only (it excludes explicit `ABORT` steps). `serializable` is the oracle verdict. `mechanism` ∈ `none | visibility | abort_concurrent_update | abort_dependencies | abort_deadlock`.
```json
{
  "schemaVersion": 1,
  "cells": {
    "dirty-read": {
      "RU":  { "invariant": "violated", "serializable": false, "aborts": {}, "mechanism": "none" },
      "RC":  { "invariant": "holds",    "serializable": true,  "aborts": {}, "mechanism": "visibility" },
      "SI":  { "invariant": "holds",    "serializable": true,  "aborts": {}, "mechanism": "visibility" },
      "SER": { "invariant": "holds",    "serializable": true,  "aborts": {}, "mechanism": "visibility" }
    },
    "non-repeatable-read": {
      "RU":  { "invariant": "violated", "serializable": false, "aborts": {}, "mechanism": "none" },
      "RC":  { "invariant": "violated", "serializable": false, "aborts": {}, "mechanism": "none" },
      "SI":  { "invariant": "holds",    "serializable": true,  "aborts": {}, "mechanism": "visibility" },
      "SER": { "invariant": "holds",    "serializable": true,  "aborts": {}, "mechanism": "visibility" }
    },
    "phantom": {
      "RU":  { "invariant": "violated", "serializable": false, "aborts": {}, "mechanism": "none" },
      "RC":  { "invariant": "violated", "serializable": false, "aborts": {}, "mechanism": "none" },
      "SI":  { "invariant": "holds",    "serializable": true,  "aborts": {}, "mechanism": "visibility" },
      "SER": { "invariant": "holds",    "serializable": true,  "aborts": {}, "mechanism": "visibility" }
    },
    "lost-update": {
      "RU":  { "invariant": "violated", "serializable": false, "aborts": {}, "mechanism": "none" },
      "RC":  { "invariant": "violated", "serializable": false, "aborts": {}, "mechanism": "none" },
      "SI":  { "invariant": "holds",    "serializable": true,  "aborts": { "T2": "abort_concurrent_update" }, "mechanism": "abort_concurrent_update" },
      "SER": { "invariant": "holds",    "serializable": true,  "aborts": { "T2": "abort_concurrent_update" }, "mechanism": "abort_concurrent_update" }
    },
    "read-skew": {
      "RU":  { "invariant": "violated", "serializable": false, "aborts": {}, "mechanism": "none" },
      "RC":  { "invariant": "violated", "serializable": false, "aborts": {}, "mechanism": "none" },
      "SI":  { "invariant": "holds",    "serializable": true,  "aborts": {}, "mechanism": "visibility" },
      "SER": { "invariant": "holds",    "serializable": true,  "aborts": {}, "mechanism": "visibility" }
    },
    "write-skew": {
      "RU":  { "invariant": "violated", "serializable": false, "aborts": {}, "mechanism": "none" },
      "RC":  { "invariant": "violated", "serializable": false, "aborts": {}, "mechanism": "none" },
      "SI":  { "invariant": "violated", "serializable": false, "aborts": {}, "mechanism": "none" },
      "SER": { "invariant": "holds",    "serializable": true,  "aborts": { "T2": "abort_dependencies" }, "mechanism": "abort_dependencies" }
    },
    "read-only-anomaly": {
      "RU":  { "invariant": "violated", "serializable": false, "aborts": {}, "mechanism": "none" },
      "RC":  { "invariant": "violated", "serializable": false, "aborts": {}, "mechanism": "none" },
      "SI":  { "invariant": "violated", "serializable": false, "aborts": {}, "mechanism": "none" },
      "SER": { "invariant": "holds",    "serializable": true,  "aborts": { "T2": "abort_dependencies" }, "mechanism": "abort_dependencies" }
    },
    "deadlock": {
      "RU":  { "invariant": "violated", "serializable": true, "aborts": { "T2": "abort_deadlock" }, "mechanism": "abort_deadlock" },
      "RC":  { "invariant": "violated", "serializable": true, "aborts": { "T2": "abort_deadlock" }, "mechanism": "abort_deadlock" },
      "SI":  { "invariant": "violated", "serializable": true, "aborts": { "T2": "abort_deadlock" }, "mechanism": "abort_deadlock" },
      "SER": { "invariant": "violated", "serializable": true, "aborts": { "T2": "abort_deadlock" }, "mechanism": "abort_deadlock" }
    }
  }
}
```

## Appendix B — Documents to produce
- **README.md:** one-line pitch, live link, hero GIF, "what it is", "how it is verified" (3 bullets with measured numbers), run locally (`make all`), architecture diagram, limits, license, contributing.
- **docs/METHODOLOGY.md:** engine semantics (§4 in prose), SSI-lite description and simplifications, oracle definition, conformance method, known divergences with regression schedules, how to reproduce every published number.
- **docs/DECISIONS.md:** dated entries: toolchain versions, WASM sizes, free-tier verification, every deviation from this spec.
- **docs/PROGRESS.md:** AC checklist; recorded long runs (200k property schedules, nightly conformance, 60-min fuzz).
- **docs/BACKLOG.md:** ideas outside scope (SQL subset, locking reads `SELECT … FOR UPDATE`, MySQL-style repeatable read, a gallery of user-submitted scenarios, i18n).

## Appendix C — References (verify each before citing in public)
1. Berenson, Bernstein, Gray, Melton, O'Neil, O'Neil. *A Critique of ANSI SQL Isolation Levels.* SIGMOD 1995. [VERIFY]
2. Cahill, Röhm, Fekete. *Serializable Isolation for Snapshot Databases.* SIGMOD 2008. [VERIFY]
3. Ports, Grittner. *Serializable Snapshot Isolation in PostgreSQL.* VLDB 2012. [VERIFY]
4. Fekete, O'Neil, O'Neil. *A Read-Only Transaction Anomaly Under Snapshot Isolation.* SIGMOD Record 2004. [VERIFY]
5. PostgreSQL documentation, *Concurrency Control* chapter (transaction isolation, explicit locking). [VERIFY the version you test against]
6. Martin Kleppmann's Hermitage project (isolation-level behavior of real databases). [VERIFY]
7. Kingsbury et al., Jepsen and the Elle checker. [VERIFY]
8. Go wiki, *WebAssembly*; MDN, *Content-Security-Policy: script-src* (`'wasm-unsafe-eval'`); Next.js docs, *Static Exports*; Vercel docs, *Limits* and *Headers*. [VERIFY current versions]

*End of specification.*