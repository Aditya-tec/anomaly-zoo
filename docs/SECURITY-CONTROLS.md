# Security controls and how each one is verified (spec section 10)

One row per control. "Check" is something you can run or read; "Result" says what it showed when P9 was done (2026-10-21). Controls that can only be seen in GitHub or Vercel settings are in `docs/REPO-SETTINGS-CHECKLIST.md`, and anything not verified is listed under **Gaps** at the end rather than claimed.

Run everything at once with: `node scripts/verify-hardening.mjs` (repository controls), `npm run build && npm run size` and `npx playwright test` in `web/` (site controls), `go test ./...` (engine controls).

## 10.1 Threat model

| Threat | Control | Check | Result |
|---|---|---|---|
| XSS from share links and DSL strings | Everything is rendered as React text nodes; no HTML sinks | `npm run lint` bans `innerHTML`, `dangerouslySetInnerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function` (the lint rules are themselves tested in `tests/lint.test.ts`); `verify-hardening.mjs` greps 49 source files for the same sinks | 0 hits |
| | Hostile text stays inert | `e2e/playground.spec.ts` "hostile content stays inert text": `<img onerror>`, `<script>`, `<svg onload>`, `javascript:` URLs in title, story, note and invariant name, via share link and typed; no element created, no dialog, nothing executed | passes in Chromium, Firefox, WebKit |
| | Strict CSP | `scripts/verify-csp.mjs` (build step) and `e2e/csp.spec.ts`: every inline script hashed, no `unsafe-inline`/`unsafe-eval` in `script-src` or `style-src`; negative controls show an unhashed script, an inline handler, an inline style attribute and a `<style>` block are blocked and reported | 22 pages, 101 hashes; controls pass in three browsers |
| Resource exhaustion | Hard limits (8 KB, 6 transactions, 200 steps, 64 keys, string caps) | `go test ./engine/dsl` (`TestLimits`, `TestValidationRules`, `TestStringCapsAreExactlyTheSpecifiedOnes`), `web/tests/limits.test.ts`, `e2e/playground.spec.ts` "limits are enforced before the engine is called" | pass |
| | Parser fuzzing | `FuzzParse` and `FuzzRun` (`.github/workflows/fuzz.yml`); 60 s local runs executed 6,155,919 `FuzzParse` inputs and 377,719 `FuzzRun` inputs with no finding | 60-minute runs: **not run** (see Gaps) |
| | 2 s worker timeout with terminate/restart | `node --test scripts/engine.test.mjs` ("client rejects after 2 s, terminates the worker and starts a fresh one") | 7/7 pass |
| | No unbounded recursion | A call-graph scan of `engine/` for functions on a call cycle found only the schema validator (`trace.validate`), whose depth is bounded by the fixed schema and which only sees engine-produced traces; the parser and the expression evaluator are iterative (expressions are flat sums of terms). Name-based hits `Format`/`eval` are different methods with the same name. | no recursion on user input |
| Supply chain | Minimal dependencies, lockfiles, `--ignore-scripts`, pinned Actions, Dependabot, scans | see 10.5 | see 10.5 |
| Tampered release | Reproducible WASM, committed hash checked in CI | `go run ./tools/buildwasm -verify` ("rebuild reproduces the committed WASM hash"); `node scripts/wasm-digest-check.mjs` (32/32 native and WASM digests equal); `e2e/hardening.spec.ts` checks the hash printed on the About page equals the SHA-256 of the file the server actually serves | pass |
| Clickjacking | `frame-ancestors 'none'` header | `e2e/csp.spec.ts` "cannot be framed": the site is embedded in a page from another origin and nothing of it appears; a control with the header removed shows the frame does render then | passes in three browsers |
| Privacy leak | No third-party requests, no cookies | `e2e/hardening.spec.ts`: across home, About, an anomaly page, the playground and a full engine re-run, the only origin requested is the site's own and no cookie exists; `verify-hardening.mjs` finds no third-party URL in web source; `connect-src 'self'` in the CSP | pass |
| Account takeover | 2FA, branch protection, no long-lived tokens | `verify-hardening.mjs`: no workflow reads `secrets`; 2FA and branch protection are settings: **not verifiable from the repository** | see Gaps |

## 10.2 Response headers

`web/vercel.json` carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (camera, microphone, geolocation, interest-cohort off), `Cross-Origin-Opener-Policy: same-origin` and `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'none'` on every page; the `/engine/*` files carry the worker CSP with `'wasm-unsafe-eval'` and the cache rules (`engine.json` no-cache, hashed WASM immutable). Checks: `verify-hardening.mjs` (general block), `e2e/csp.spec.ts` ("every page carries a CSP meta ... and the response headers are in place", against the real headers served by `scripts/serve.mjs`), and `node web/scripts/check-deployed.mjs <url>` (CSP and headers on every page, usable on the production URL). No HSTS `preload` anywhere. COOP is unchanged (the Firefox test-server workaround stays until the owner reports a live result).

## 10.3 Per-page CSP

`scripts/inject-csp.mjs` hashes every inline script and inserts the meta policy; `scripts/verify-csp.mjs` re-checks both directions. **`style-src` is now `'self'` only**: the transaction colours and timeline grid placement that used inline `style` attributes were moved to classes and `data-txn` attributes (`app/grid-classes.css`, generated by `scripts/gen-grid-css.mjs`, freshness checked by a unit test), and `verify-csp.mjs` now fails the build on any `style=` attribute or `<style>` block in the output or on `'unsafe-inline'` in `style-src`. The only inline style in the live DOM is Next.js's own `<next-route-announcer>`, which it sets through the CSSOM; the CSP does not govern that and no violation is reported on any route.

## 10.4 Input handling

| Rule | Check | Result |
|---|---|---|
| Share links: reject > 4 KB, strict base64url, reject invalid UTF-8, then source limits | `web/tests/share.test.ts`, `e2e/playground.spec.ts` (oversized and malformed links) | pass |
| Caps: title 80, story 400, note 120, invariant name 80 (characters) | `TestStringCapsAreExactlyTheSpecifiedOnes` pins the four constants and the exact boundary with 1-, 2- and 3-byte characters | pass; **matches the spec** |
| Control characters | The parser and the web pre-check **reject** a string or source containing one (NUL, 0x01, 0x07, 0x1b, 0x7f are tested in each of the four fields). The spec says "strip". Rejection was kept deliberately: silently deleting characters would change the scenario that is run. See DECISIONS.md. | deviation, logged |
| Unknown query/hash parameters ignored | `web/tests/urlstate.test.ts`, `share.test.ts` ("other hashes are ignored") | pass |
| Never reflect input into `<title>`, meta tags or URLs | `e2e/playground.spec.ts` "input is never reflected ...": `<title>`, every `<meta>` and `<link>` are identical before and after running hostile input via link and editor, and the query string stays empty. Page metadata is built at build time from the manifest. The one input-derived part of a URL is the `#s=` share payload itself (base64url), which is the feature (spec 7.6). | pass |
| `localStorage` not needed for correctness, wrapped in try/catch | The only use is the theme choice (`layout.tsx` boot script and `ThemeToggle.tsx`), both in try/catch; `e2e/journeys.spec.ts` "works without localStorage" | pass |

## 10.5 Supply chain and repository hygiene

`node scripts/verify-hardening.mjs` prints one line per control; at the end of P9 it reported **28/28 controls verified**, and it was shown to fail on a deliberately bad workflow (unpinned `uses`, `pull_request_target`, a secret, `${{ }}` inside `run:`, a write permission). It covers: all 26 `uses:` pinned to a 40-hex SHA with a version comment; `permissions: {}` at the top of all 5 workflows; no `pull_request_target`; no secrets; no `${{ }}` inside `run:`; only write permission is CodeQL's `security-events`; `.npmrc` (`ignore-scripts=true`, `save-exact=true`); 3 production dependencies (limit 5), all versions exact; lockfile committed; CI uses `npm ci --ignore-scripts` only; Go toolchain pinned; the engine module has no dependencies and `pgx` is only in `conformance/`; Dependabot for gomod (root and `conformance/`), npm (`web/`) and github-actions, weekly; CodeQL for Go and JavaScript/TypeScript on pull requests and weekly; `SECURITY.md`, `LICENSE` (MIT), `THIRD_PARTY_NOTICES.md`, `CHANGELOG.md`, `docs/REPO-SETTINGS-CHECKLIST.md` present.

Scans (2026-10-21): `govulncheck ./...` root module "No vulnerabilities found" (after moving the toolchain to go1.27.3, which also rebuilt the committed WASM); `govulncheck ./...` in `conformance/` "No vulnerabilities found" (after `golang.org/x/text` 0.29.0 to 0.41.0 and toolchain go1.27.3); `npm audit --omit=dev --audit-level=high` and `npm audit` (all dependencies) both "found 0 vulnerabilities". CI repeats all of these in the `security` job and uploads the all-dependencies audit as an artifact.

## 10.6 Privacy

The About page's Privacy section contains the sentence "No cookies, no analytics, no third-party requests, no fingerprinting." (asserted by `e2e/hardening.spec.ts`), followed by one more sentence that is also true and needed: the theme button stores the choice in the browser's local storage and nothing is sent anywhere. The measured behaviour backs it: only the site's origin is requested, no cookie is set (see 10.1).

## Gaps (not verified, or not done)

* **AC9.2, the 60-minute fuzz runs, have not been run.** `fuzz.yml` is written (dispatch it with `fuzztime: 60m`); only 60-second local runs were done (`FuzzParse` 6,155,919 executions, `FuzzRun` 377,719). There is no committed fuzz-found regression input because none was found.
* **CodeQL has not run yet** (the workflow exists; it runs on the first pull request or weekly schedule after this push). "CodeQL green" is therefore unproven. Dependabot's first run is also still to come.
* **GitHub and Vercel settings** (branch protection, private vulnerability reporting, Dependabot alerts, secret scanning, 2FA, Actions policy, Vercel project settings) cannot be checked from the repository: see `docs/REPO-SETTINGS-CHECKLIST.md`. Branch protection is deliberately not enabled yet.
* **Production headers.** The headers are verified against the local test server that applies `vercel.json`, not against a Vercel deployment (`check-deployed.mjs` is ready for it). Whether Vercel adds HSTS on its own domain is unverified, and the repository does not set it.
* **Worker CSP in each browser.** The e2e tests load the worker and WebAssembly under the real headers in Chromium, Firefox and WebKit without a violation; real devices and desktop Safari are not tested.
* **`frame-ancestors` cannot be set by the GitHub Pages fallback** (no custom headers), as the spec notes; the fallback is documented, not enabled.
* **Coverage** is a gate on statement coverage of `engine/...` (91.9% measured with `-short`); the gate is not a statement about the quality of the tests.
* **Stripping vs rejecting control characters** differs from the spec's wording on purpose (above).
