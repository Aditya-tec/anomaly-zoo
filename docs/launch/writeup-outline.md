# Optional write-up (outline)

Working title: "What I learned building MVCC and SSI from scratch". Publish on a free blogging platform of your choice, after the launch posts, as the follow-up post in the plan.

The most surprising finding is a real one, and it is the part worth writing:

1. **PostgreSQL's own answer varies.** When a commit or abort releases two waiting transactions at once, running the *same* schedule on PostgreSQL gives different final states from run to run: the minimal schedule is `engine/testdata/regressions/wake-order-race.azs`. In the comparison, PostgreSQL's history varied in 43 of the 132 Read Committed schedules in which two statements were blocked at the same time [source: web/public/conformance.json, random.RC.raceVariants and random.RC.raceSchedules]. A single waiting transaction was identical to the engine in 100 of 100 runs at each of the three levels (method: docs/METHODOLOGY.md, experiment 2). The engine serves waiters first-in-first-out; the cost of that simplification is measured.
2. **Background vacuum changed Serializable answers.** With autovacuum on, one Serializable schedule gave a different PostgreSQL history in 6 of 900 runs; with it off on the harness tables, in 0 of 1,200 (docs/METHODOLOGY.md, experiment 4). Worth a section on why a comparison harness has to control the database's background work.
3. **PostgreSQL's Serializable aborts transactions that share no key.** Its read locks are per index page, and a control experiment with the keys moved to different pages made it agree with the engine (docs/METHODOLOGY.md, experiments 5 and 6; minimal schedule `ser-disjoint-keys.azs`).
4. **A hypothesis I had to drop.** I expected the lower transaction id to decide who wins a race for a key; an experiment showed it skews the outcome but does not decide it, so the page says "cause not yet established" for that divergence (docs/METHODOLOGY.md, experiment 3).
5. **Things that did not need a story to be interesting:** mutation checks (two of the five Serializable rules are redundant in this model), the shrinker producing 8-step counterexamples, a reproducible WebAssembly build.

[MISSING: which of these you want to lead with; your own voice and first-person account; the repository link]

Keep the limits section from the README, and do not call any of this proof.
