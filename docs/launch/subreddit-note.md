# Subreddits (note, not a post)

Candidates named in the plan: r/PostgreSQL, r/programming. Before posting anywhere:

1. **Read that community's current rules on self-promotion and Show-and-Tell posts first.** They change and are not summarised here. [MISSING: the rules for each subreddit, read on the day]
2. Post only where the rules allow it. If a community wants a particular format, a flair, or a weekly thread, follow that.
3. Do not cross-post everywhere on the same day. Space posts out, and reply to comments in each before posting in the next.
4. Do not ask for votes. Say plainly that you made it, and what is verified and what is simplified (the limits).
5. For r/PostgreSQL in particular: lead with the comparison method and its differences (the `docs/METHODOLOGY.md` divergences), because that is what that audience can check. Say it was compared at three isolation levels on one PostgreSQL version.

Suggested short text, if the rules allow a text post (adapt it; keep the limits):

> I built a small engine that replays isolation anomalies step by step (write skew, lost update, phantom, ...) and lets you flip the isolation level. It was compared with PostgreSQL 16.15 on 500 random schedules per level [source: web/public/conformance.json, corpus.randomPerLevel]; the differences are documented, and two causes are still open. It is a simplified model, not a database. Feedback welcome, especially on anything it gets wrong.
