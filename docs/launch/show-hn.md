# Show HN (draft)

Check Hacker News's current Show HN rules and guidelines on the day you post; they are not summarised here. Do not ask for upvotes, in the post or anywhere else.

## Title

Show HN: Anomaly Zoo – watch database isolation anomalies happen, step by step

(URL field: https://anomaly-zoo.vercel.app [MISSING: confirm the production URL is live before posting])

## First comment

[MISSING: two or three sentences of your own motivation. I do not know why you built it and will not invent a story.]

What it is: a from-scratch MVCC engine in Go (standard library only) that runs scripted schedules of two or three transactions at four isolation levels. The site replays each step (versions, lock waits, who aborts and why), and you can switch the level and watch an anomaly appear or disappear. It also has a playground where you write your own schedule; the engine is compiled to WebAssembly and runs in your browser. No backend, no tracking.

What is verified and how:

- The anomaly matrix (eight anomalies by four levels) is computed by running the engine and asserted in CI; there are no hand-written outcomes in the web app.
- The Serializable level was checked against a serializability oracle on 20,000 random schedules per level in every test run, and on 200,000 in one local run: 0 histories rejected [source: docs/PROGRESS.md, AC4.2]. Deliberately disabling any of three edge-tracking rules makes tests fail, and the counterexamples shrink to 8 steps [source: docs/PROGRESS.md, AC4.3].
- Compared with PostgreSQL 16.15 on 10,000 random schedules per level (one nightly run, GitHub Actions run 39734736774): 8,294 of 8,623 identical at Read Committed (about 96.2%) and 8,882 of 8,979 at Snapshot Isolation (about 98.9%); "about" because PostgreSQL's own result varies when several statements wait on the same lock (two runs on identical seeds differed by 0.3 points at Read Committed) [source: web/public/conformance-10k.json, random.RC and random.SI]. For context only, not a result to quote: among schedules where no two statements were blocked at once, 6,831 of 6,831 and 7,064 of 7,064, a subset chosen after the fact to explain the differences, not an independent result [source: web/public/conformance-10k.json, random.RC and random.SI]. At Serializable both sides were serializable in 10,000 of 10,000, with the same aborted set in about 93.0% [source: web/public/conformance-10k.json, random.SER]. The 500-schedule sample CI runs on every push is the PR gate [source: web/public/conformance.json].
- The differences are documented with a minimal schedule each; three are marked "cause not yet established" [source: web/public/conformance-10k.json, knownDivergences]. The harness itself found that PostgreSQL's own result for the same schedule varies from run to run when two statements are blocked at the same time (method: docs/METHODOLOGY.md).

Limits: keys and integers with prefix scans, no SQL or durability; a deterministic single-threaded simulation, not real concurrency; the Serializable level is simplified (key-prefix predicate locks, no read-only optimisation). PostgreSQL 16 only, on schedules without DELETE.

I would like you to try to break it: write a schedule in the playground that the engine gets wrong, or tell me where an explanation is unclear.
