# Launch assets (drafts only: nothing here has been posted)

Spec section 13.1 and 13.2. Everything in this folder is a draft for the owner to review and post. Figures in the post drafts are copied from recorded sources and each paragraph that has one says where it comes from (`[source: ...]`); anything that has not been measured is a visible `[MISSING: ...]` placeholder, not a guess. `node scripts/check-claims.mjs` (run in CI) fails if a draft has a banned phrase, a figure that is in no recorded source, or a paragraph with figures and no marker.

## Assets

| File | What it is | How it was made |
|---|---|---|
| `hero.mp4` | 24 s recording of write skew: Snapshot Isolation (zero on call), flip to Serializable, T2 aborts, the invariant holds | `cd web && npm run build && node scripts/record-launch.mjs` (needs `ffmpeg`) |
| `hero.gif` | The same clip as a GIF under 5 MB | same command (it backs off width, frame rate and colours until the file fits) |
| `habitat-map-light.png`, `habitat-map-dark.png` | The map, clean | `cd web && node scripts/launch-stills.mjs` |
| `how-verified.png` | "How it is verified": engine to oracle, engine and PostgreSQL on shared schedules, with measured numbers read from `conformance.json` and `docs/PROGRESS.md` when the script runs | same command |
| `carousel-1-bug.png`, `carousel-2-fix.png`, `carousel-3-proof.png` | The bug, the fix, the proof (1080 x 1350) | same command |
| `linkedin.md`, `x-thread.md`, `show-hn.md`, `subreddit-note.md`, `writeup-outline.md` | Post drafts | written by hand from recorded numbers |

The captions in the clip and in the first two carousel stills are an overlay that the scripts inject into the page they photograph; the site itself contains no such code. The recording context disables the Content-Security-Policy for that overlay only (the real policy is tested in `web/e2e/csp.spec.ts`). The raw `.webm` is not committed (`hero.raw.webm` is git-ignored).

## If you change the production URL

Run `node scripts/site-url.mjs --set https://your-host.example` from the repository root, then `cd web && npm run build && npm run og` and commit. The URL printed on the share images and in these drafts follows.

## Before posting

* Open the production URL and check the clip and numbers still match what the site shows. Re-run `node scripts/check-claims.mjs`.
* Read the current rules of each place you post (Hacker News guidelines, each subreddit's self-promotion rules) on the day. They are not summarised here because they change.
* Check how the link looks on each platform with the platform's own link preview or card validator. That could not be tested from here.
