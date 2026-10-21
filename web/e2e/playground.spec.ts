import { expect, test, type Page } from "@playwright/test";
import { NO_INVARIANT_SOURCE, b64url, expectClean, isEngineUrl, shareUrl, stepCount, watchPage } from "./helpers";

const editor = (page: Page) => page.getByTestId("source");
const results = (page: Page) => page.getByTestId("playground-results");
const pickLevel = (page: Page, lv: string) => page.locator(`label:has([data-testid="level-${lv}"])`).click();

/** Sets the textarea exactly (browsers' fill() drops control characters) and tells React about it. */
async function setSource(page: Page, value: string) {
  await editor(page).evaluate((el, v) => {
    const ta = el as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(ta, v);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function openPlayground(page: Page, hash = "") {
  await page.goto("about:blank");
  await page.goto(`/playground${hash}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Playground");
}

test.describe("J3: playground", () => {
  test("loads with an example, loads the engine only when asked, runs, and shows the same viewer", async ({ page }) => {
    const w = await watchPage(page);
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));
    await openPlayground(page);
    await expect(editor(page)).toHaveValue(/^scenario write-skew/);
    expect(urls.filter(isEngineUrl), "the engine must not be requested before the user acts").toEqual([]);

    // Line numbers: one gutter row per line of the source.
    const lineCount = (await editor(page).inputValue()).split("\n").length;
    await expect(page.getByTestId("editor-gutter")).toHaveAttribute("data-lines", String(lineCount));
    expect(await page.locator('[data-testid="editor-gutter"] > span').count()).toBe(lineCount);

    await page.getByTestId("run").click();
    await expect(page.getByTestId("playground-status")).toContainText("Ran the scenario at all four levels.");
    await expect(results(page).getByTestId("result-banner")).toHaveAttribute("data-outcome", "occurs");
    await expect(results(page).getByTestId("banner-headline")).toHaveText("Write Skew occurs at Snapshot Isolation.");
    // The very same components as the anomaly pages: timeline, store, explain, compare strip.
    for (const id of ["timeline", "store-panel", "explain-panel", "compare-strip", "level-switch"]) await expect(results(page).getByTestId(id)).toBeVisible();
    expect(urls.some((u) => /\.wasm$/.test(u))).toBe(true);

    // Same step-through behaviour, and it reproduces the published numbers.
    const n = stepCount("write-skew", "SI");
    await expect(page.getByTestId("step-label")).toHaveText(`Step 0 of ${n}`);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByTestId("explain-headline")).toHaveText("T1 begins.");
    await pickLevel(page, "SER");
    await expect(results(page).getByTestId("result-banner")).toHaveAttribute("data-outcome", "prevented");
    await expectClean(page, w);
  });

  test("no invariants: the oracle verdict, with the exact sentence when no serial order exists", async ({ page }) => {
    await openPlayground(page);
    await editor(page).fill(NO_INVARIANT_SOURCE);
    await editor(page).press("ControlOrMeta+Enter");
    const banner = results(page).getByTestId("result-banner");
    await expect(banner).toHaveAttribute("data-outcome", "not-serializable"); // default level: the highest where it goes wrong, SI
    await expect(results(page).getByTestId("serializability")).toContainText("No serial order of the committed transactions produces these reads and this final state.");
    await expect(banner).toContainText("Not serializable");
    await expect(results(page).getByTestId("invariant-badge")).toHaveCount(0);

    await pickLevel(page, "SER");
    await expect(banner).toHaveAttribute("data-outcome", "serializable");
    await expect(results(page).getByTestId("serializability")).toContainText("Equivalent to running the committed transactions one at a time in this order: T1");
    await expect(page.getByTestId("compare-RU")).toContainText("Not serializable");
  });

  test("errors list with line:col; clicking one focuses that line", async ({ page }) => {
    await openPlayground(page);
    const src = "scenario x\nschedule:\n  T1 BEGIN\n  T1 FROB\n  T1 COMMIT\n";
    await editor(page).fill(src);
    await page.getByTestId("run").click();
    const list = page.getByTestId("source-errors");
    await expect(list).toBeVisible();
    await expect(results(page).getByTestId("result-banner")).toHaveCount(0);
    const btn = list.getByTestId("error-line").first();
    const label = (await btn.textContent()) ?? "";
    const m = /^(\d+):(\d+)$/.exec(label.trim());
    expect(m, `error button text "${label}"`).not.toBeNull();
    expect(Number(m![1])).toBe(4);
    await expect(list).toContainText("unknown operation");

    await page.getByTestId("run").focus(); // move focus away first
    await btn.click();
    await expect(editor(page)).toBeFocused();
    const sel = await editor(page).evaluate((el) => ({ s: (el as HTMLTextAreaElement).selectionStart, e: (el as HTMLTextAreaElement).selectionEnd }));
    const lines = src.split("\n");
    const lineStart = lines.slice(0, 3).reduce((n, l) => n + l.length + 1, 0);
    expect(sel.s).toBeGreaterThanOrEqual(lineStart);
    expect(sel.e).toBe(lineStart + lines[3]!.length);
    expect(await editor(page).getAttribute("aria-invalid")).toBe("true");

    // Fixing it clears the list on the next run.
    await editor(page).fill(src.replace("FROB", "NOTE \"ok\""));
    await page.getByTestId("run").click();
    await expect(page.getByTestId("source-errors")).toHaveCount(0);
    await expect(results(page).getByTestId("result-banner")).toBeVisible();
  });

  test("Load example fills the editor from the manifest's scenarios and runs it", async ({ page }) => {
    await openPlayground(page);
    const menu = page.getByTestId("example-menu");
    await expect(menu.locator("option:not([disabled])")).toHaveCount(8);
    await menu.selectOption("lost-update");
    await expect(editor(page)).toHaveValue(/^scenario lost-update/);
    await expect(results(page).getByTestId("banner-headline")).toHaveText("Lost Update occurs at Read Committed.");
    await menu.selectOption("deadlock");
    await expect(editor(page)).toHaveValue(/^scenario deadlock/);
    await expect(results(page).getByTestId("banner-headline")).toContainText("Deadlock occurs at");
  });

  test("results are marked stale when the source changes after a run", async ({ page }) => {
    await openPlayground(page);
    await page.getByTestId("run").click();
    await expect(results(page).getByTestId("result-banner")).toBeVisible();
    await expect(page.getByTestId("stale-note")).toHaveCount(0);
    await editor(page).press("End");
    await editor(page).type(" ");
    await expect(page.getByTestId("stale-note")).toBeVisible();
  });
});

test.describe("share links", () => {
  test("round trip: Share produces a link that reproduces the scenario and its results in a fresh page", async ({ page, context }) => {
    await openPlayground(page);
    await editor(page).fill(NO_INVARIANT_SOURCE);
    await page.getByTestId("run").click();
    await expect(results(page).getByTestId("result-banner")).toBeVisible();
    await page.getByTestId("share").click();
    const link = await page.getByTestId("share-link").inputValue();
    expect(link).toMatch(/\/playground#s=[A-Za-z0-9_-]+$/);
    expect(link.slice(link.indexOf("#s=") + 3)).toBe(b64url(NO_INVARIANT_SOURCE));

    const fresh = await context.newPage();
    const w = await watchPage(fresh);
    await fresh.goto(link);
    await expect(editor(fresh)).toHaveValue(NO_INVARIANT_SOURCE);
    await expect(results(fresh).getByTestId("result-banner")).toHaveAttribute("data-outcome", "not-serializable");
    await expectClean(fresh, w);
  });

  test("a scenario too large for a link says so instead of producing a broken link", async ({ page }) => {
    await openPlayground(page);
    const big = "scenario big\nschedule:\n  T1 BEGIN\n" + Array.from({ length: 60 }, (_, i) => `  T1 NOTE "${"n".repeat(48)} ${i}"`).join("\n") + "\n  T1 COMMIT\n";
    expect(Buffer.byteLength(big)).toBeGreaterThan(3072);
    expect(Buffer.byteLength(big)).toBeLessThan(8192);
    await editor(page).fill(big);
    await page.getByTestId("share").click();
    await expect(page.getByTestId("share-note")).toContainText("too large to share");
    await expect(page.getByTestId("share-link")).toHaveCount(0);
  });

  const bad: [string, string][] = [
    ["empty", "#s="],
    ["oversize (4097 characters)", `#s=${"A".repeat(4097)}`],
    ["a 100 KB payload", `#s=${"A".repeat(100 * 1024)}`],
    ["characters outside base64url", "#s=%25%25%25"],
    ["standard base64 alphabet", "#s=ab+/cd"],
    ["padding", "#s=YQ=="],
    ["an impossible length", "#s=A"],
    ["non-canonical bits", "#s=a_"],
    ["invalid UTF-8", `#s=${b64url(Buffer.from([0xff, 0xfe, 0xfd]))}`],
    ["a null byte", `#s=${b64url(Buffer.from([0x61, 0x00, 0x62]))}`],
    ["control characters", `#s=${b64url(Buffer.from([0x1b, 0x5b, 0x41]))}`],
  ];
  for (const [name, hash] of bad) {
    test(`refuses a link with ${name}: inline error, nothing runs, no blank page`, async ({ page }) => {
      const urls: string[] = [];
      page.on("request", (r) => urls.push(r.url()));
      const w = await watchPage(page);
      await openPlayground(page, hash);
      await expect(page.getByTestId("link-error")).toBeVisible();
      await expect(page.getByTestId("link-error")).toContainText("Nothing was run");
      await expect(editor(page)).toHaveValue(/^scenario write-skew/); // the default example, never the garbage
      await expect(results(page).getByTestId("result-banner")).toHaveCount(0);
      await expect(page.getByTestId("run")).toBeVisible();
      expect(urls.filter(isEngineUrl), "a refused link must not start the engine").toEqual([]);
      await expectClean(page, w);
    });
  }

  test("a valid link whose scenario does not parse shows the parse errors and runs nothing", async ({ page }) => {
    await openPlayground(page, shareUrl("scenario x\nschedule:\n  T1 NOPE\n").slice("/playground".length));
    await expect(page.getByTestId("source-errors")).toBeVisible();
    await expect(results(page).getByTestId("result-banner")).toHaveCount(0);
    await expect(editor(page)).toHaveValue(/T1 NOPE/);
  });

  test("changing the hash in the same tab loads the new link", async ({ page }) => {
    await openPlayground(page);
    await page.evaluate((h) => { window.location.hash = h; }, shareUrl(NO_INVARIANT_SOURCE).slice("/playground".length));
    await expect(editor(page)).toHaveValue(NO_INVARIANT_SOURCE);
    await expect(results(page).getByTestId("result-banner")).toBeVisible();
  });
});

test.describe("hostile content stays inert text", () => {
  const evil = [
    "scenario evil",
    'title "<img src=x onerror=window.__pwned=1>: more"',
    'story "javascript:window.__pwned=1"',
    'invariant "<script>window.__pwned=1</script>": a == 1',
    "setup:",
    "  PUT k = 1",
    "schedule:",
    "  T1 BEGIN",
    "  T1 READ k AS a",
    '  T1 NOTE "<svg onload=window.__pwned=1><a href=javascript:window.__pwned=1>x</a>"',
    "  T1 COMMIT",
    "",
  ].join("\n");

  test("a share link with <script>, event handlers, svg and javascript: URLs renders as text and executes nothing", async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    const w = await watchPage(page);
    await openPlayground(page, shareUrl(evil).slice("/playground".length));
    const res = results(page);
    await expect(res.getByTestId("result-banner")).toBeVisible();
    // Step to the NOTE so it is shown in the timeline and the explain panel.
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Next" }).click();

    // Text, not markup.
    await expect(res.getByTestId("banner-headline")).toContainText("<img src=x onerror=window.__pwned=1>");
    await expect(res.getByTestId("result-banner")).toContainText("<script>window.__pwned=1</script>");
    await expect(res.getByTestId("timeline")).toContainText("<svg onload=window.__pwned=1><a href=javascript:window.__pwned=1>x</a>");
    // Nothing was created from it.
    for (const sel of ["img", "script", "iframe", "object", "embed", "[onerror]", "[onload]", "[onclick]", 'a[href^="javascript"]', "svg[onload]"]) {
      expect(await res.locator(sel).count(), sel).toBe(0);
    }
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(dialogs).toEqual([]);
    await expectClean(page, w);
  });

  test("input is never reflected into <title>, meta tags, link tags or the URL (spec 10.4)", async ({ page }) => {
    const head = () =>
      page.evaluate(() => ({
        title: document.title,
        meta: [...document.querySelectorAll("meta")].map((m) => `${m.getAttribute("name") ?? m.getAttribute("property") ?? m.getAttribute("http-equiv")}=${m.getAttribute("content")}`),
        links: [...document.querySelectorAll("link")].map((l) => `${l.getAttribute("rel")}=${l.getAttribute("href")}`),
      }));
    await openPlayground(page);
    const baseline = await head();
    await openPlayground(page, shareUrl(evil).slice("/playground".length));
    await expect(results(page).getByTestId("result-banner")).toBeVisible();
    await editor(page).fill(evil.replace("scenario evil", "scenario evilid"));
    await page.getByTestId("run").click();
    await expect(results(page).getByTestId("result-banner")).toBeVisible();
    const after = await head();
    expect(after).toEqual(baseline);
    expect(JSON.stringify(after)).not.toMatch(/evil|pwned|<img|<script|javascript:/i);
    const loc = await page.evaluate(() => ({ search: location.search, path: location.pathname, hash: location.hash }));
    expect(loc.search).toBe("");
    expect(loc.path).toBe("/playground");
    // The only input-derived part of the URL is the share payload itself (spec 7.6): base64url, no raw text.
    expect(loc.hash).toMatch(/^(#s=[A-Za-z0-9_-]*)?$/);
  });

  test("hostile text typed into the editor is just as inert", async ({ page }) => {
    await openPlayground(page);
    await editor(page).fill(evil);
    await page.getByTestId("run").click();
    await expect(results(page).getByTestId("result-banner")).toBeVisible();
    expect(await results(page).locator("img, script, [onerror], [onload]").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test("oversized or malformed titles are parse errors, not rendered", async ({ page }) => {
    await openPlayground(page);
    await editor(page).fill(`scenario x\ntitle "${"<b>".repeat(40)}"\nschedule:\n  T1 BEGIN\n  T1 COMMIT\n`);
    await page.getByTestId("run").click();
    await expect(page.getByTestId("source-errors")).toContainText("title exceeds 80 characters");
    expect(await page.locator("b").count()).toBe(0);
  });
});

test.describe("limits are enforced before the engine is called", () => {
  test("over 8 KB, too many steps, too many transactions, control characters", async ({ page }) => {
    await openPlayground(page);
    const cases: [string, RegExp][] = [
      ["#" + "x".repeat(8300), /bytes; the limit is 8,192/],
      ["scenario s\nschedule:\n" + Array.from({ length: 201 }, () => '  T1 NOTE "x"').join("\n") + "\n", /201 steps; the limit is 200/],
      ["scenario s\nschedule:\n" + [1, 2, 3, 4, 5, 6, 7].map((n) => `  T${n} BEGIN`).join("\n") + "\n", /7 transactions; the limit is 6/],
      ["scenario s\u0001\n", /control characters/],
    ];
    for (const [src, msg] of cases) {
      await setSource(page, src);
      await page.getByTestId("run").click();
      await expect(page.getByTestId("source-errors")).toContainText(msg);
      await expect(results(page).getByTestId("result-banner")).toHaveCount(0);
    }
  });
});

test.describe("engine problems", () => {
  test("a worker that never answers: a clear timeout message after 2 s, then the next run works", async ({ page }) => {
    let served = 0;
    // Context-level: requests made by the worker itself are only visible there.
    await page.context().route("**/engine/worker.js", async (route) => {
      served++;
      if (served === 1) {
        // The first worker is a stub that never replies.
        await route.fulfill({
          status: 200,
          contentType: "text/javascript",
          headers: { "content-security-policy": "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'" },
          body: "self.onmessage = function () { /* sleeps forever */ };",
        });
      } else {
        await route.continue();
      }
    });
    await openPlayground(page);
    const t0 = Date.now();
    await page.getByTestId("run").click();
    await expect(page.getByTestId("engine-problem")).toHaveText("The engine did not answer within 2 seconds, so it was restarted. Try a smaller schedule.", { timeout: 15_000 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1900);
    await expect(results(page).getByTestId("result-banner")).toHaveCount(0);
    // The hung worker was terminated; a fresh one serves the next run.
    await page.getByTestId("run").click();
    await expect(results(page).getByTestId("result-banner")).toBeVisible({ timeout: 20_000 });
    expect(served).toBeGreaterThanOrEqual(2);
  });

  test("the engine cannot be loaded: a clear message, and a retry works once it can", async ({ page }) => {
    let blocked = true;
    await page.context().route("**/engine/engine.json", async (route) => {
      if (blocked) await route.abort("failed");
      else await route.continue();
    });
    await openPlayground(page);
    await page.getByTestId("run").click();
    await expect(page.getByTestId("engine-problem")).toHaveText("The engine could not be loaded. Check your connection and try again.", { timeout: 20_000 });
    blocked = false;
    await page.getByTestId("run").click();
    await expect(results(page).getByTestId("result-banner")).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("Re-run in your browser (anomaly pages)", () => {
  test("nothing is fetched until the button is pressed; then the digests are compared", async ({ page }) => {
    const w = await watchPage(page);
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));
    await page.goto("/anomalies/write-skew");
    await expect(page.getByTestId("viewer")).toHaveAttribute("data-ready", "true");
    await page.getByTestId("level-SER").focus();
    await page.waitForTimeout(500);
    expect(urls.filter(isEngineUrl), "the engine must not load before the user opts in").toEqual([]);

    const wasm = page.waitForResponse((r) => /\/engine\/azoo\.[0-9a-f]{8}\.wasm$/.test(r.url()));
    await page.getByTestId("rerun-button").click();
    await expect(page.getByTestId("rerun-identical")).toContainText("✓ identical to the published trace", { timeout: 30_000 });
    await expect(page.getByTestId("rerun-mismatch")).toHaveCount(0);

    // The engine file keeps its production caching and content type.
    const res = await wasm;
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/wasm");
    expect(res.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    await expectClean(page, w);
  });

  test("every anomaly's scenario re-runs identically in the browser", async ({ page }) => {
    test.setTimeout(180_000);
    for (const slug of ["dirty-read", "lost-update", "deadlock", "read-only-anomaly"]) {
      await page.goto(`/anomalies/${slug}`);
      await expect(page.getByTestId("viewer")).toHaveAttribute("data-ready", "true");
      await page.getByTestId("rerun-button").click();
      await expect(page.getByTestId("rerun-identical"), slug).toBeVisible({ timeout: 30_000 });
    }
  });

  test("a digest that differs is reported honestly, with both digests, and never as identical", async ({ page }) => {
    // Corrupt the SI digest in the worker's reply, as a different engine build would.
    await page.addInitScript(() => {
      const Real = window.Worker;
      const Wrapped = function (url: string | URL, opts?: WorkerOptions) {
        const w = new Real(url, opts);
        // Registered before the client's own handler, so it runs first.
        w.addEventListener("message", (ev: MessageEvent) => {
          const d = ev.data as { result?: { traces?: Record<string, { digest: string }> } };
          if (d?.result?.traces?.SI) d.result.traces.SI.digest = "f".repeat(64);
        });
        return w;
      };
      Wrapped.prototype = Real.prototype;
      window.Worker = Wrapped as unknown as typeof Worker;
    });    await page.goto("/anomalies/write-skew");
    await expect(page.getByTestId("viewer")).toHaveAttribute("data-ready", "true");
    await page.getByTestId("rerun-button").click();
    const mismatch = page.getByTestId("rerun-mismatch");
    await expect(mismatch).toBeVisible({ timeout: 30_000 });
    await expect(mismatch).toContainText("does not match the published trace");
    await expect(mismatch).toContainText("Snapshot Isolation (SI): different");
    await expect(mismatch).toContainText("your browser: " + "f".repeat(64));
    await expect(mismatch).toContainText(/published: [0-9a-f]{64}/);
    await expect(mismatch).toContainText("Serializable (SER): identical");
    await expect(page.getByTestId("rerun-identical")).toHaveCount(0);
  });

  test("the 'Run it yourself' link opens this scenario in the playground, which then runs it", async ({ page }) => {
    await page.goto("/anomalies/lost-update");
    await page.getByTestId("run-it-yourself").click();
    await expect(page).toHaveURL(/\/playground#s=/);
    await expect(editor(page)).toHaveValue(/^scenario lost-update/);
    await expect(results(page).getByTestId("banner-headline")).toHaveText("Lost Update occurs at Read Committed.");
  });
});

test.describe("hidden-in-P6 features are now visible", () => {
  test("the header links to the playground on every page, and the sitemap lists it", async ({ page, request }) => {
    for (const route of ["/", "/about", "/anomalies/phantom", "/playground"]) {
      await page.goto(route);
      await expect(page.locator('header a[href="/playground"]')).toHaveCount(1);
    }
    expect(await (await request.get("/sitemap.xml")).text()).toContain("/playground");
  });
});

// AC7.2: only the playground (once used) and the Re-run button may ever fetch the engine.
test.describe("the engine is never requested without an opt-in", () => {
  test("/, /about and all eight /anomalies/* pages: load, interact, still no engine or .wasm request", async ({ page }) => {
    test.setTimeout(120_000);
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));
    for (const route of ["/", "/about", "/anomalies/dirty-read", "/anomalies/non-repeatable-read", "/anomalies/phantom", "/anomalies/lost-update", "/anomalies/read-skew", "/anomalies/write-skew", "/anomalies/read-only-anomaly", "/anomalies/deadlock"]) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      if (route.startsWith("/anomalies/")) {
        await expect(page.getByTestId("viewer")).toHaveAttribute("data-ready", "true");
        await page.getByRole("button", { name: "Next" }).click();
        await page.locator('label:has([data-testid="level-SER"])').click();
        await page.getByRole("button", { name: "Collapse" }).click();
        await page.waitForTimeout(300);
      }
    }
    expect(urls.filter(isEngineUrl), "no engine request without a click on Re-run or a visit to the playground").toEqual([]);
    expect(urls.length).toBeGreaterThan(20);
  });

  test("the playground itself fetches nothing from /engine/ until the first run (or an intent signal)", async ({ page }) => {
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));
    await page.goto("/playground");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    expect(urls.filter(isEngineUrl)).toEqual([]);
  });
});
