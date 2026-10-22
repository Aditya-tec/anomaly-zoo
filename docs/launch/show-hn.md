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
- Compared with PostgreSQL 16.15 on 500 random schedules per level: 415 of 434 identical at Read Committed and 441 of 446 at Snapshot Isolation. For context only, not a result to quote: among schedules where no two statements were blocked at once, 345 of 345 and 351 of 351, a subset chosen after the fact to explain the differences, not an independent result [source: web/public/conformance.json, random.RC and random.SI]. At Serializable both sides were serializable in 500 of 500, with the same aborted set in 91.8% [source: web/public/conformance.json, random.SER].
- The differences are documented with a minimal schedule each; three are marked "cause not yet established" [source: web/public/conformance.json, knownDivergences]. The harness itself found that PostgreSQL's own result for the same schedule varies from run to run when two statements are blocked at the same time (method: docs/METHODOLOGY.md).

Limits: keys and integers with prefix scans, no SQL or durability; a deterministic single-threaded simulation, not real concurrency; the Serializable level is simplified (key-prefix predicate locks, no read-only optimisation). PostgreSQL 16 only, on schedules without DELETE.

I would like you to try to break it: write a schedule in the playground that the engine gets wrong, or tell me where an explanation is unclear.
