# Release checklist (spec section 11.5)

Status key: **done** = verified here, with the evidence shown; **not done** = could be done by the project but is not yet; **mine** = needs the owner's account, a deployment, or a decision, and was deliberately not done. Last full local run: 2026-10-22 (see "Evidence of the last local run" at the bottom). Nothing here has been tagged, deployed or posted.

## The spec's release checklist

| # | Item | Status | Evidence / how to check |
|---|---|---|---|
| 1 | Every acceptance criterion in section 12 ticked | **partly mine** | `docs/PROGRESS.md` lists each AC. Open ones: AC0.2 to AC0.6 (owner's live checks on the Vercel preview; AC0.2's Firefox/WebKit half is covered by the e2e suite), AC8.5 (nightly 10,000 run: **mine** to dispatch), AC9.2 (60-minute fuzz runs: **mine** to dispatch), AC10.1 (production URL: **mine**). `grep -n "\[ \]" docs/PROGRESS.md` |
| 2 | Lighthouse budgets green | **done locally and in CI**; production URL **mine** | CI `e2e` job step "Lighthouse (mobile profile ...)"; locally `cd web && npm run lighthouse`. On the production URL: run Lighthouse against it (AC10.1) |
| 3 | Size gates green | **done** | `cd web && npm run build && npm run size` (first-load JS, trace sizes, WASM gzip against the 1.5 MB gate) |
| 4 | CSP smoke test clean on all routes | **done** | `web/e2e/hardening.spec.ts` (every built page, light and dark, three browsers) and `web/e2e/csp.spec.ts`; on a deployed URL: `node web/scripts/check-deployed.mjs https://<host>` (**mine**, needs the deployment) |
| 5 | `conformance.json` regenerated for the current engine version | **done** | `jq -r .engineVersion web/public/conformance.json` equals `go run ./cmd/azoo version` (checked in CI step "conformance.json engineVersion equals azoo version"). The committed file is the report of CI run 39578910902; the engine's behaviour did not change when the Go toolchain moved to go1.27.3 (all engine gates re-run), and the `conformance` CI job passed again afterwards. Regenerate with `make conformance` against PostgreSQL 16 if you want a fresh run |
| 6 | README hero GIF recorded | **done** | `docs/launch/hero.gif` (4.72 MB, under the 5 MB limit) and `docs/launch/hero.mp4`; recreate with `cd web && node scripts/record-launch.mjs` |
| 7 | METHODOLOGY and limits pages final | **done** | `docs/METHODOLOGY.md` (engine semantics, oracle, property tests, mutation checks, conformance, all five divergences, limits); About page limits and conformance section render from `conformance.json` |
| 8 | OG images present | **done** | `web/public/og/*.png` (nine files); `web/tests/og.test.ts` fails if one is missing or stale. If you change the production URL: `node scripts/site-url.mjs --set <url>` then `cd web && npm run build && npm run og` |
| 9 | `SECURITY.md` and `LICENSE` present | **done** | `SECURITY.md`, `LICENSE` (MIT); `node scripts/verify-hardening.mjs` |
| 10 | Repo description and topics set | **mine** | Suggested text is in `docs/REPO-SETTINGS-CHECKLIST.md`, item 11 |
| 11 | **Re-verify free-tier terms** and record the date | **mine** | Check: Vercel Hobby plan terms and limits (the non-commercial clause, bandwidth and build limits) at <https://vercel.com/pricing> and <https://vercel.com/legal/terms>; GitHub Actions minutes for public repositories in GitHub's billing documentation; GitHub Pages limits only if the fallback is used. **Date re-verified: ____-__-__ (fill in after you have re-checked).** Nothing in this repository asserts what those terms say |
| 12 | Rollback plan | **mine** (verify) | Redeploy or promote the previous deployment from the Vercel dashboard (availability on Hobby is unverified here) or `git revert` the bad commit on `main`. There is no backend or data, so rollback is safe |
| 13 | Versioning: SemVer, `CHANGELOG.md`, tag `v1.0.0` at launch | **changelog done; tag mine** | `CHANGELOG.md` has a 1.0.0 entry marked "not yet tagged". Tag it yourself: `git tag -a v1.0.0 -m "v1.0.0" && git push origin v1.0.0` after the checks below |

## Steps that are only yours

1. **Deploy.** In Vercel, switch the project's Root Directory from `spike` to `web` (the build settings are in `web/vercel.json`; add no environment variables; leave Analytics and Speed Insights off). Then run `node web/scripts/check-deployed.mjs https://<your-host>` and Lighthouse on the production URL.
2. **Production URL.** If the Vercel name is not `anomaly-zoo.vercel.app`, run `node scripts/site-url.mjs --set https://<your-host>`, then `cd web && npm run build && npm run og`, commit. `node scripts/site-url.mjs --check` (in CI) fails if a document quotes a different URL.
3. **Delete `spike/`** in its own commit once `web/` is deployed (nothing else depends on it).
4. **Live Firefox check** (the COOP workaround stays in the local test server until you report the result).
5. **Dispatch the long runs:** `conformance-nightly` (10,000 per level, three shards) and `fuzz` (`fuzztime: 60m`); record both results in `docs/PROGRESS.md`.
6. **GitHub settings** in `docs/REPO-SETTINGS-CHECKLIST.md` (branch protection last).
7. **Pre-launch review:** send the preview link to three to five engineers and fix what confuses them.
8. **Launch assets:** review `docs/launch/`, fill every `[MISSING: ...]`, check the link previews on each platform, then post.
9. **Tag `v1.0.0`.**

## Evidence of the last local run (2026-10-22)

Commands run from the repository root unless noted; see `docs/PROGRESS.md`, section P10, for the output.

* `node scripts/check-claims.mjs` and `node --test scripts/check-claims.test.mjs`
* `node scripts/site-url.mjs --check`, `node scripts/verify-hardening.mjs`, `node scripts/gen-third-party-notices.mjs --check`
* `gofmt -l .`, `go vet ./...`, `go test ./...`, `go run ./cmd/azoo matrix scenarios --check`, `go run ./tools/buildwasm -verify`, `node --test scripts/engine.test.mjs`
* in `web/`: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run size`, `npx playwright test`
