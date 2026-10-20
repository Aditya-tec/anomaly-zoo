# Copy to review (P6)

The rule for P6 was: ship only copy the spec provides; anything invented goes here instead of shipping silently. In practice a site cannot be built from the spec's wording alone (buttons, headings, labels, sentences that join generated facts), so this file lists **every piece of text that is mine rather than the spec's**, where it lives, and what I would change it to if you disagree. Nothing here states a measured number, a statistic, or anything about PostgreSQL or another database.

Legend: **[spec]** is taken from the spec verbatim or nearly so; **[mine]** is written by me and needs your eyes; **[claim-check]** says something about databases in general and should be checked before launch.

## 1. Spec copy used as written (for reference, no action unless you want changes)
- Tagline: "Watch database isolation bugs happen. Then turn them off." (spec header). `lib/site.ts`.
- One-line level definitions, spec §8.2, all four. `lib/levels.ts`.
  - **[claim-check]** The Read Uncommitted definition ends "...most databases do not offer it." That is a general statement about databases; it is the spec's own text, kept as written.
- "Why the levels differ" paragraphs, spec §8.3, one per anomaly. `lib/why.ts`.
- Reason-code sentences, spec §5.7, all 18 (with Tn/Ta/Tb filled from the trace). `lib/reasons.ts`.
- The sentence for a history no serial order explains, spec §7.6: "No serial order of the committed transactions produces these reads and this final state." `lib/outcomes.ts`.
- Scenario titles (also used as the one-line hook, so no separate hook was invented) and stories, spec §6.1, via `manifest.json`.
- "Check your own database's documentation: behavior differs between vendors and versions." spec §8.4. `lib/why.ts`.
- Privacy line, spec §10.6: "No cookies, no analytics, no third-party requests, no fingerprinting."

## 2. Deliberately NOT shipped
- The §8.2 footnote ("In PostgreSQL, Read Committed, Repeatable Read, and Serializable correspond to RC, SI, and SER here." marked [VERIFY]). It is a PostgreSQL statement; not rendered anywhere.
- The "PostgreSQL has no read-uncommitted" phrasing and every PostgreSQL badge text. The badge component exists (`components/PgBadge.tsx`) and renders nothing.
- §13.3 limit 3 and limit 4 mention PostgreSQL ("PostgreSQL has no equivalent [VERIFY]"; "...than PostgreSQL; the conformance report quantifies this"). Reworded, see 3e.
- The "Run it yourself" link and `/playground` navigation (P7). The About-page conformance section (P8; not rendered, guarded by `SHOW_CONFORMANCE_SECTION = false`).

## 3. Copy I wrote [mine]

### 3a. Home page (`app/page.tsx`)
- Eyebrow: "An interactive museum of database concurrency bugs" (from spec §1.1 "An interactive museum of database concurrency bugs").
- Hero paragraph: "A from-scratch transactional engine runs scripted schedules of two or three transactions at four isolation levels. Step through a schedule, watch a bug happen, flip the isolation level, and see the mechanism that prevents it." (paraphrase of §1.1).
- Map intro: "Each row is a concurrency bug and each column an isolation level. Choose a cell to replay that run."
- "How it works" and its three steps: "Read the short story behind a bug." / "Step through the schedule and watch the transactions interleave." / "Flip the isolation level, replay, and compare what changed." (from journey J1, §1.3).
- Limits card: heading "A teaching engine, not a database"; body "Keys hold integers, interleavings are a deterministic simulation rather than real concurrency, and the Serializable level is a simplified version. Your own database's documentation is the authority on how it behaves."; link text "Read the limits". (assembled from §13.3 limits 1, 2, 4, 5).
- Page title/description: "An interactive museum of database concurrency bugs, replayed step by step at four isolation levels."

### 3b. Site shell
- Navigation: "Habitat map", "About". Theme button: "Theme: System / Light / Dark". Skip link: "Skip to content".
- Footer: "Anomaly Zoo is a teaching engine written from scratch, not a database. A deterministic simulation of interleavings, not real concurrency." and "No cookies, no analytics, no third-party requests. Read the limits."
- 404 page: "Page not found" / "That page is not in the zoo." / "Back to the habitat map".

### 3c. Generated sentences (templates, filled with engine data) `lib/outcomes.ts`, `lib/explain.ts`
- Outcome words/glyphs: "✓ Prevented", "✗ Occurs", "– Not evaluated" (spec §7.3 gives the first two; the third is mine).
- Result banner: "<Anomaly> occurs at <Level>." / "<Anomaly> is prevented at <Level>." / "<Anomaly> was not evaluated at <Level>."; detail lines `Invariant "<name>": <holds|violated> (<detail>).` and `<Tn> aborted: <reason summary>.`
- Abort summaries (shortened from §5.7): "could not serialize access due to a concurrent update (first updater wins)", "could not serialize access due to read/write dependencies among transactions", "deadlock detected", "arithmetic out of range", "still waiting when the schedule ended; rolled back".
- Mechanism sentence when a level prevents a bug with no abort: **"The visibility rules kept the conflicting write out of sight."** and when nothing intervenes: **"No protection at this level."** (spec §6.2 has a "mechanism" column with words like "visibility (committed versions only)"; I wrote sentences from the code `visibility`/`none`). These appear in map tooltips, mobile cards and banners.
- Serializability verdict when a serial order exists: "Equivalent to running the committed transactions one at a time in this order: T3 → T1." and "No transactions committed." (spec §7.4 asks for "witness order" but gives no sentence). Heading "Serializable history: yes./no."
- Explain panel (the spec gives reason sentences; the connecting sentences are mine): "T1 begins.", "T1 tries to commit.", "T1 rolls back.", "T1 reads balance.", "T1 scans the keys starting with "doctor:" where value == 1.", "T1 writes balance = 150.", "T1 deletes k.", "Resumed: ...", "Before the first step.", "Starting data: ...", "Result: 100.", "Result: the key is absent.", "Result: 2 rows (...), sum 2.", "Wrote balance = 150 (not committed yet).", "Marked k as deleted (not committed yet).", "T1 committed at timestamp 2.", "Released the write lock on balance.", "T1 is still waiting on an earlier statement, so this step waits its turn." (queued), "T2 is now doomed: it will abort at its next operation." (the spec has no sentence for the `doomed` effect), "(through doctor:)" after the dependency sentence, "(version by T0, committed at 1)".

### 3d. Anomaly page and viewer
- "← Habitat map". **"An illustration, not an incident report."** (spec §8.4 requires illustrations to be labelled as such but gives no wording; shown under every story).
- "In practice": spec §8.4 gives prose ("retry on serialization failures; prefer atomic updates (`SET v = v + 50`)...; add constraints or unique indexes; take explicit locks when needed; choose the weakest level that is correct and test it"). I turned it into a bullet list with the intro **"General guidance, not vendor claims:"** and sentence-cased items. Same content, my wording.
- Viewer labels: "Timeline", "Keyboard: ← and → to step, Space to play or pause, R to reset.", buttons "Back" "Next" "Play" "Pause" "Reset", "Step 5 of 11", "What just happened", "Store", "Show/Hide" (phone drawer), table headers "Key", "Versions", "uncommitted", "deleted", "(changed by this step)", "Snapshots: T1 @1, T2 @1.", "No transaction has taken a snapshot yet.", "T0 is the setup data, committed at 1.", "Compare the four levels", "Collapse/Expand", "Show SER", "Showing SER", "Invariant and verdict", "Isolation level" (screen-reader label), "Timeline: one lane per transaction, time flows downwards" (region label).
- Event cards: "waiting on T2", "aborted: <summary>", "rolled back", "skipped: its transaction already aborted", "queued behind a blocked statement", "resumed from step 5", "Step 5".
- Per-anomaly page titles and descriptions: the anomaly name, and the scenario story as description.

### 3e. About page (`app/about/page.tsx`)
- Headings: "About Anomaly Zoo", "Methodology", "The four levels", "Limits", "FAQ", "Privacy", "Verify the engine build", "Links".
- Methodology: "Anomaly Zoo is a from-scratch MVCC engine written in Go using only the standard library. It runs scripted schedules of two or three transactions at four isolation levels and records every step as a trace." and "The habitat map is computed by running the engine and is asserted against expected results in continuous integration. These pages replay those recorded traces; the engine itself does not run in your browser here." (from the §13.3 allowed claims; the second sentence describes P6 only and must change in P7).
- Limits (the five of §13.3 with two edits): **3** "Read Uncommitted is included for teaching, to show dirty reads." (dropped "PostgreSQL has no equivalent [VERIFY]"); **4** "The Serializable level is a simplified version: it uses prefix-level predicate locks and has no read-only optimization, so it can abort more transactions than a production database would." (replaced "than PostgreSQL; the conformance report quantifies this").
- FAQ: three questions I chose, answered only with spec text: "Does this behave exactly like my database?" (limit 5 + the §8.4 closing line), "Why is Read Uncommitted included?" (§8.2 RU definition), "Why can Serializable abort a transaction?" (§8.2 SER definition).
- Privacy: spec §10.6 sentence plus **"If you use the theme button, your choice is kept in your browser's local storage; nothing is sent anywhere."** (the spec says no cookies; localStorage for the theme is allowed by the task but not mentioned in the spec's privacy line).
- Engine build: "The committed WebAssembly build of the engine (1.0.0, built with go1.27.0) has this SHA-256. Rebuilding it from source with the pinned Go toolchain gives the same hash." (true: CI rebuilds and compares; see docs/DECISIONS.md).
- Link text: "Source code on GitHub".

## 4. Design choices that affect what visitors see (not copy, but worth a look)
- Default level per anomaly = the highest level at which the bug still happens (computed from the data): Dirty Read RU, Lost Update RC, Write Skew SI, Deadlock SER. The spec's §7.4 example banner implies this but does not say it.
- Switching the level keeps the same step (clamped), so the same moment can be compared; Reset starts over.
- "No. 01 ... No. 08" numbering on the map rows (specimen-label look, §7.9) follows the teaching order of §6.1.
