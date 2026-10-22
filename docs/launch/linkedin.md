# LinkedIn post (draft)

Attach: `hero.mp4` (or `hero.gif`), and the carousel stills `carousel-1-bug.png`, `carousel-2-fix.png`, `carousel-3-proof.png` as a document or image set.

---

Two doctors go off call at the same time. Your transaction just broke the hospital's one rule.

That is write skew, and it can happen under Snapshot Isolation. I built Anomaly Zoo so you can watch it happen step by step, switch the isolation level, and see exactly what stops it.

Anomaly Zoo is a transactional engine written from scratch in Go (standard library only). It runs scripted schedules of two or three transactions at four isolation levels, and the site replays every step: versions, lock waits, who aborts and why. It runs entirely in your browser; there is no backend and no tracking.

What is different about it: the outcomes are not written by hand. The matrix of eight anomalies by four levels is computed by running the engine and asserted in CI. The Serializable level was checked against a serializability oracle on 20,000 random schedules per level in every test run, with 0 histories rejected [source: docs/PROGRESS.md, AC4.2]. And I compared the engine with PostgreSQL 16.15 on 10,000 random schedules per level (one nightly run, GitHub Actions run 39734736774): 8,294 of 8,623 identical at Read Committed (about 96.2%) and 8,882 of 8,979 at Snapshot Isolation (about 98.9%) [source: web/public/conformance-10k.json, random.RC and random.SI]. The figure is "about" because PostgreSQL's own result varies when several statements wait on the same lock. The differences are listed with a minimal schedule each.

One honest limit: it is a simplified model (keys and integers, no SQL, a deterministic simulation rather than real concurrency), and its Serializable level is not PostgreSQL's. It explains the concepts; your database's documentation is the authority.

Try it: https://anomaly-zoo.vercel.app [MISSING: confirm the production URL is live and the page matches before posting]
Source and method: [MISSING: the GitHub repository link once you decide to make it the post's link]

What is the worst concurrency bug you have run into in production? I would like to turn a few of them into schedules.
