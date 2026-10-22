# X thread, 6 posts (draft)

Check each post's length in the composer before posting. Attach the file named in brackets in each post.

---

**1/6** (attach `hero.mp4`)
Two doctors go off call at the same time. Your transaction just broke the hospital's one rule.

Watch write skew happen, step by step, then flip the isolation level and watch it get stopped. Runs in your browser.
https://anomaly-zoo.vercel.app [MISSING: confirm the production URL is live before posting]

**2/6** (attach `habitat-map-light.png`)
Eight anomalies by four isolation levels. Every cell is computed by running the engine, not written by hand, and CI asserts the whole matrix.

Click any cell to replay that run.

**3/6** (attach `engine-diagram.png`)
How the engine works: each transaction reads from a snapshot of committed versions. Writers take locks and wait in line. At Serializable it also tracks who read what another transaction wrote, and aborts one when they form a dangerous pattern.

**4/6** (attach `how-verified.png`)
How it is checked: the Serializable level ran on 20,000 random schedules per level in every test run against a serializability oracle, 0 histories rejected [source: docs/PROGRESS.md, AC4.2]. Not a proof; evidence.

**5/6**
And PostgreSQL 16.15, on 500 random schedules per level: 415 of 434 identical at Read Committed, 441 of 446 at Snapshot Isolation [source: web/public/conformance.json, random.RC and random.SI]. The differences are listed, two with "cause not yet established" [source: conformance.json, knownDivergences].

**6/6**
What it is not: keys and integers, no SQL, a deterministic simulation, a simplified Serializable level. It explains concepts; your database's docs are the authority.

Try to break it, and tell me what is confusing. [MISSING: the repository link to post here]
