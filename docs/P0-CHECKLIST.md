# P0 checklist (AC0.2-AC0.6)

These are the checks that need your accounts or other browsers. Everything the agent could run locally is listed first so you know what is already established, and what is not.

Commands are PowerShell, from the repository root. Replace `<host>` with your Vercel preview or production host (no scheme).

## Already established locally (re-run any time)

| Check | Command | Expected |
|---|---|---|
| Spike builds and CSP hashes verify | `cd spike; npm ci --ignore-scripts; npm run build` | ends with `verify-csp: OK, 3 page(s), 9 hash(es)` |
| Spike in Chromium with the real headers | `cd spike; npm run serve` (leave running), then in a second shell `node scripts/browser-check.mjs --browser "C:\Program Files\Google\Chrome\Application\chrome.exe"` | `status: OK`, both digests equal, `problems ... none`, `BROWSER CHECK: PASS` |
| Same in Edge | same, `--browser "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"` | PASS |
| Engine tests | `go test ./...` and `node --test scripts/engine.test.mjs` | all pass |

Measured by the agent on 2026-10-20, Windows 11, Chrome and Edge headless, server = `spike/scripts/serve.mjs` applying `spike/vercel.json`: PASS in both, and two negative controls behaved as they must: an inline script without a hash was blocked, and a worker CSP without `'wasm-unsafe-eval'` made the WASM fail with a CompileError. That is **not** Vercel, **not** Firefox and **not** WebKit, which is what AC0.2 asks for.

## One-time Vercel setup (needed for AC0.2-AC0.4)

1. https://vercel.com, "Continue with GitHub", **Hobby** plan. If anything asks for a payment method, stop (spec rule: no card, ever).
2. Add New > Project > import `Aditya-tec/anomaly-zoo` (the repo is private; that is fine on Hobby).
3. **Root Directory: `spike`.** Framework preset: Next.js. The install and build commands come from `spike/vercel.json` (`npm ci --ignore-scripts`, `npm run build`); confirm the dashboard shows them. Leave **Output Directory** at its default (do not set it to `out`): for Next.js, Vercel's builder reads that setting as Next's `distDir` (`.next`) and finds the static export in `out/` by itself through `.next/export-detail.json`.
4. Project Settings > General: make sure **"Include source files outside of the Root Directory in the Build Step"** is ON. The spike build reads `web/public/engine`, `scenarios/` and `engine/testdata` from the repo root, and `prepare.mjs` fails with a clear message if they are missing.
5. Add **no** environment variables. Do **not** enable Web Analytics or Speed Insights.
6. Deploy. For a preview, push a branch (for example `p0-spike`) and open the Vercel preview URL from the commit status or PR.

If step 4 is not available on your plan, the fallback is a plain static deployment from the repository root: Root Directory = repository root, Framework Preset **Other**, Install Command `npm ci --ignore-scripts --prefix spike`, Build Command `npm run build --prefix spike`, Output Directory `spike/out`, and move `spike/vercel.json` to the repository root with `"framework": null` and without `installCommand`/`buildCommand`. (With the Next.js preset the output directory means Next's `distDir`, so `out` only works with the Other preset.) Tell the agent and it will adjust.

## AC0.2: worker instantiates the WASM under the headers, zero CSP violations, three browsers

Click path: open `https://<host>/` in each browser (Chrome or Edge; Firefox; Safari, or Playwright's WebKit if you have no Mac: `npx playwright install webkit`).

Pass, in **each** of the three engines:
- the page shows `status: OK`, `engine: 1.0.0`, and `digest (wasm)` equal to `digest (gold)` (`bd0ff105...` unless the golden trace changed);
- `csp violations seen by the page: 0`;
- DevTools console: no error or warning, in the page context **and** in the worker context (Chrome: Console > the "top" dropdown; Firefox: Debugger > Threads; Safari: Web Inspector > Console, worker context).

Fail: `status: ERROR` or `MISMATCH`, or any "Refused to ..." / "violates the following Content Security Policy" line. Copy the exact message into `docs/DECISIONS.md`. A Firefox or WebKit failure that does not occur in Chromium means the worker-header CSP assumption (spec §10.3 [VERIFY]) is wrong for that engine; stop and tell the agent (the spec's fallback is a Vite SPA with strict header CSP).

## AC0.3: static export gets a working per-page meta CSP, no violations

1. On the deployed page: View Source. The first element inside `<head>` must be `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'sha256-...' ...">`, before any `<script>`.
2. Count the `<script>` tags that have no `src`: each one's SHA-256 (base64) must appear in `script-src`. The build already enforces this (`verify-csp`); the check here is that the **deployed** HTML is the same.
3. `script-src` must not contain `'unsafe-inline'`, `'unsafe-eval'` or `'wasm-unsafe-eval'`.
4. Visit `https://<host>/does-not-exist`: the 404 page must also carry a meta CSP and show no console errors.

Pass: all four hold and AC0.2 passed. Fail: any inline script blocked in any browser. Then follow spec §10.3: switch the web app to a Vite static SPA and record why in `docs/DECISIONS.md`.

## AC0.4: caching and content-type headers

```powershell
curl.exe -sI https://<host>/engine/engine.json
curl.exe -sI https://<host>/engine/azoo.2249ad7f.wasm
curl.exe -sI https://<host>/engine/worker.js
curl.exe -sI https://<host>/
curl.exe -sI -H "accept-encoding: br" https://<host>/engine/azoo.2249ad7f.wasm
```

(`azoo.2249ad7f.wasm` is the current file name; use the `wasm` value from `web/public/engine/engine.json` if it has changed.)

Pass:
| URL | Required headers |
|---|---|
| `/engine/engine.json` | `cache-control: no-cache` (must NOT contain `immutable`), `content-type: application/json` |
| `/engine/azoo.<hash8>.wasm` | `cache-control: public, max-age=31536000, immutable`, `content-type: application/wasm` |
| `/engine/worker.js`, `wasm_exec.js`, `client.mjs` | `cache-control: public, max-age=0, must-revalidate` (these files are not content-hashed, so they must not be immutable) |
| `/engine/*` | `content-security-policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'` |
| `/` | `content-security-policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'none'` plus `x-content-type-options: nosniff`, `referrer-policy: no-referrer`, `permissions-policy`, `cross-origin-opener-policy: same-origin` |

Also check: each response has exactly **one** `content-security-policy` header (the rules in `spike/vercel.json` are deliberately non-overlapping so Vercel's merge order does not matter; if you see two, tell the agent). Record whether `strict-transport-security` is present and its value (spec §10.2 [VERIFY]; do not add `preload`). With `accept-encoding: br`, record `content-encoding` and `content-length` for the WASM (the agent measured 1,041,981 B for brotli level 11).

## AC0.5: CI Postgres service container accepts SELECT 1

1. Push a branch or open a PR. GitHub > Actions > workflow `ci`.
2. Open job **conformance**, step "AC0.5 - SELECT 1 against the postgres:16 service container".

Pass: the job is green and the log contains `--- PASS: TestPostgresSelect1` and a line `PostgreSQL server_version 16.x`. A skipped test fails the job on purpose (`AZOO_REQUIRE_DB=1`).

Also look at job **go**: it runs gofmt, `go vet`, staticcheck, `go test -race -short` and the full `go test`. Its first Linux run is also the first time the committed WASM hash is rebuilt on a non-Windows machine (`tools/buildwasm` test `TestCommittedEngineMatchesSource`). If that test fails with a hash difference, the build is not reproducible across operating systems; tell the agent, with the two hashes.

Optional local run (needs Docker Desktop started; it was not running when the agent tried):
```powershell
docker run --rm -d --name azoo-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
cd conformance
$env:CONFORMANCE_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable"
$env:AZOO_REQUIRE_DB = "1"
go test -count=1 -v ./...
docker stop azoo-pg
```

## AC0.6: free-tier terms re-verified and dated

Visit each page, read the current terms, and add a dated row to `docs/DECISIONS.md` with the URL and what you found. Do not copy numbers from this repository; the spec says terms change.

| Service | What to confirm |
|---|---|
| Vercel Hobby | still free with no card; non-commercial use only; bandwidth and build limits; "Include source files outside of the Root Directory" available |
| GitHub Actions | **the repository is currently private**: private repos get a monthly minute allowance on the Free plan, public repos do not. The spec's "free for public repos" assumption does not apply while it is private. Check your allowance, and note that the `go` job (race run plus the full property run) can take tens of minutes per push |
| GitHub Pages (fallback host) | repo visibility requirement for Pages on your plan, size and bandwidth limits, no custom headers |
| Cloudflare Pages (fallback host) | whether signup asks for a card (spec [VERIFY]) |
| Postgres service container | runs on the standard runner; no extra cost |

Pass: every row has a date, a URL and a yes/no. Anything that now needs a card or a payment is a stop-and-tell.

## When all of the above pass

Tick AC0.2-AC0.6 in `docs/PROGRESS.md` and tell the agent. Only then does P6 start.
