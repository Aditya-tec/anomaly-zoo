import { expect, test, type Page } from "@playwright/test";
import { LEVELS, ROUTES, SLUGS, expected, expectClean, stepCount, watchPage, type Lv } from "./helpers";

async function openViewer(page: Page, url: string) {
  await page.goto(url);
  const viewer = page.getByTestId("viewer");
  await expect(viewer).toHaveAttribute("data-ready", "true");
  return viewer;
}

const stepLabel = (page: Page) => page.getByTestId("step-label");
const pickLevel = (page: Page, lv: Lv) => page.locator(`label:has([data-testid="level-${lv}"])`).click();

test.describe("J2: compare (habitat map)", () => {
  test("every one of the 32 cells shows the outcome the Go engine expects, and links to that run", async ({ page }) => {
    const w = await watchPage(page);
    await page.goto("/");
    await expect(page.getByTestId("habitat-map")).toBeVisible();
    for (const slug of SLUGS) {
      for (const lv of LEVELS) {
        const cell = page.getByTestId(`cell-${slug}-${lv}`);
        const want = expected[slug]![lv].invariant === "violated" ? "occurs" : "prevented";
        await expect(cell, `${slug}@${lv}`).toHaveAttribute("data-outcome", want);
        await expect(cell).toContainText(want === "occurs" ? "Occurs" : "Prevented");
        await expect(cell).toHaveAttribute("href", `/anomalies/${slug}?level=${lv}`);
      }
    }
    await expectClean(page, w);
  });

  test("clicking a cell opens that anomaly at that level", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("cell-write-skew-SER").click();
    await expect(page).toHaveURL(/\/anomalies\/write-skew\?level=SER/);
    const viewer = page.getByTestId("viewer");
    await expect(viewer).toHaveAttribute("data-ready", "true");
    await expect(viewer).toHaveAttribute("data-level", "SER");
    await expect(page.getByTestId("result-banner")).toHaveAttribute("data-outcome", "prevented");
  });

  test("the mechanism is available on focus", async ({ page }) => {
    await page.goto("/");
    const cell = page.getByTestId("cell-write-skew-SER");
    await cell.focus();
    await expect(page.locator("#mech-write-skew-SER")).toBeVisible();
    await expect(page.locator("#mech-write-skew-SER")).toContainText("T2 aborted");
  });
});

test.describe("J1: learn (anomaly page)", () => {
  test("read the story, step through, see the bug, flip the level, see it prevented", async ({ page }) => {
    const w = await watchPage(page);
    const viewer = await openViewer(page, "/anomalies/write-skew");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Write Skew");
    await expect(page.getByText("Alice and Bob are both on call")).toBeVisible();

    // The highest level where the bug still happens is chosen from the data: SI.
    await expect(viewer).toHaveAttribute("data-level", "SI");
    await expect(page.getByTestId("result-banner")).toHaveAttribute("data-outcome", "occurs");
    await expect(page.getByTestId("banner-headline")).toHaveText("Write Skew occurs at Snapshot Isolation.");

    const n = stepCount("write-skew", "SI");
    await expect(stepLabel(page)).toHaveText(`Step 0 of ${n}`);
    for (let i = 1; i <= n; i++) {
      await page.getByRole("button", { name: "Next" }).click();
      await expect(stepLabel(page)).toHaveText(`Step ${i} of ${n}`);
      await expect(page.getByTestId(`event-${i - 1}`)).toHaveAttribute("aria-current", "step");
    }
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
    await expect(page.getByTestId("serializability")).toContainText("No serial order of the committed transactions produces these reads and this final state.");

    // Flip the level: the same moment in the run, now under Serializable.
    await pickLevel(page, "SER");
    await expect(viewer).toHaveAttribute("data-level", "SER");
    await expect(page.getByTestId("result-banner")).toHaveAttribute("data-outcome", "prevented");
    await expect(page.getByTestId("result-banner")).toContainText("T2 aborted: could not serialize access due to read/write dependencies");
    const last = stepCount("write-skew", "SER");
    await expect(page.getByTestId(`event-${last - 1}`)).toHaveAttribute("data-status", "aborted");
    await expect(page.getByTestId("level-definition")).toContainText("Snapshot isolation plus detection of dangerous read→write patterns.");

    await page.getByRole("button", { name: "Reset" }).click();
    await expect(stepLabel(page)).toHaveText(`Step 0 of ${last}`);
    await expectClean(page, w);
  });

  test("lost update at RC shows a blocked statement and its resumed counterpart", async ({ page }) => {
    await openViewer(page, "/anomalies/lost-update?level=RC&step=9");
    const blocked = page.locator('[data-status="blocked"]');
    await expect(blocked).toHaveCount(1);
    await expect(blocked).toContainText("waiting on T1");
    const resumed = page.locator('[data-resumed="true"]');
    await expect(resumed).toHaveCount(1);
    await expect(resumed).toContainText("resumed from step");
    await expect(page.getByTestId("banner-headline")).toHaveText("Lost Update occurs at Read Committed.");
  });

  test("the store follows the steps: a write is uncommitted until its commit", async ({ page }) => {
    await openViewer(page, "/anomalies/lost-update?level=RC&step=0");
    const store = page.getByTestId("store-panel");
    await expect(store).toContainText("balance");
    await expect(store).not.toContainText("uncommitted");
    await page.getByRole("button", { name: "Next" }).click(); // T1 BEGIN
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Next" }).click(); // ... T1 PUT
    await expect(store).toContainText("uncommitted");
    await expect(store.locator('[data-changed="true"]')).toContainText("balance");
    await expect(page.getByTestId("snapshots")).toContainText("No transaction has taken a snapshot yet.");
  });

  test("the explain panel is a polite live region that follows the current event", async ({ page }) => {
    await openViewer(page, "/anomalies/write-skew?level=SER");
    await expect(page.locator('[data-testid="explain-panel"] [aria-live="polite"]')).toHaveCount(1);
    await expect(page.getByTestId("explain-headline")).toHaveText("Before the first step.");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByTestId("explain-headline")).toHaveText("T1 begins.");
  });

  test("the compare strip shows all four levels and collapses", async ({ page }) => {
    await openViewer(page, "/anomalies/write-skew?level=SI&step=4");
    for (const lv of LEVELS) await expect(page.getByTestId(`compare-${lv}`)).toBeVisible();
    await page.getByRole("button", { name: "Collapse" }).click();
    await expect(page.getByTestId("compare-RU")).toBeHidden();
    await page.getByRole("button", { name: "Expand" }).click();
    await expect(page.getByTestId("compare-RU")).toBeVisible();
    await page.getByTestId("compare-SER").getByRole("button", { name: "Show SER" }).click();
    await expect(page.getByTestId("viewer")).toHaveAttribute("data-level", "SER");
  });

  test("every anomaly page renders its generated banner, Why-the-levels-differ and In-practice sections", async ({ page }) => {
    for (const slug of SLUGS) {
      await page.goto(`/anomalies/${slug}`);
      await expect(page.getByTestId("result-banner")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Why the levels differ" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "In practice" })).toBeVisible();
      await expect(page.getByText("Check your own database's documentation")).toBeVisible();
    }
  });
});

test.describe("URL is the source of truth", () => {
  test("level and step are read from the URL and written back", async ({ page }) => {
    const viewer = await openViewer(page, "/anomalies/write-skew?level=SER&step=5");
    await expect(viewer).toHaveAttribute("data-level", "SER");
    await expect(viewer).toHaveAttribute("data-step", "5");
    await expect(stepLabel(page)).toHaveText(`Step 5 of ${stepCount("write-skew", "SER")}`);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page).toHaveURL(/level=SER&step=6/);
    await pickLevel(page, "RC");
    await expect(page).toHaveURL(/level=RC&step=6/);
  });

  test("invalid or unknown parameters are ignored", async ({ page }) => {
    for (const q of ["?level=XX&step=abc", "?step=99999", "?level=<script>alert(1)</script>", "?step=-3&foo=bar"]) {
      const viewer = await openViewer(page, `/anomalies/write-skew${q}`);
      await expect(viewer).toHaveAttribute("data-level", "SI");
      await expect(viewer).toHaveAttribute("data-step", "0");
    }
  });

  test("the hash and other parts of the URL survive stepping", async ({ page }) => {
    await openViewer(page, "/anomalies/write-skew#why-h");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page).toHaveURL(/\?level=SI&step=1#why-h$/);
  });
});

test.describe("keyboard shortcuts", () => {
  test("arrows step, Space plays and pauses, R resets", async ({ page }) => {
    const viewer = await openViewer(page, "/anomalies/write-skew?level=SI");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(viewer).toHaveAttribute("data-step", "2");
    await page.keyboard.press("ArrowLeft");
    await expect(viewer).toHaveAttribute("data-step", "1");
    await page.keyboard.press("r");
    await expect(viewer).toHaveAttribute("data-step", "0");

    await page.keyboard.press(" ");
    await expect.poll(async () => Number(await viewer.getAttribute("data-step")), { timeout: 8000 }).toBeGreaterThanOrEqual(1);
    await page.keyboard.press(" ");
    const frozen = await viewer.getAttribute("data-step");
    await page.waitForTimeout(1300);
    await expect(viewer).toHaveAttribute("data-step", frozen ?? "");
  });

  test("playback stops by itself at the end", async ({ page }) => {
    const viewer = await openViewer(page, `/anomalies/dirty-read?level=RU&step=${stepCount("dirty-read", "RU") - 2}`);
    await page.getByRole("button", { name: "Play" }).click();
    await expect(viewer).toHaveAttribute("data-step", String(stepCount("dirty-read", "RU")), { timeout: 8000 });
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  });

  test("keys keep their normal job inside the level radios (arrows change the level, not the step)", async ({ page }) => {
    const viewer = await openViewer(page, "/anomalies/write-skew?level=SI&step=3");
    await page.locator('[data-testid="level-SI"]').focus();
    await page.keyboard.press("ArrowRight");
    await expect(viewer).toHaveAttribute("data-level", "SER");
    await expect(viewer).toHaveAttribute("data-step", "3");
  });
});

test.describe("no engine on the pages (AC7.2 groundwork)", () => {
  test("browsing the home page and anomaly pages never requests the engine or WASM", async ({ page }) => {
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));
    await page.goto("/");
    await page.getByTestId("cell-lost-update-RC").click();
    await expect(page.getByTestId("viewer")).toHaveAttribute("data-ready", "true");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("link", { name: "← Habitat map" }).click();
    await page.goto("/about");
    expect(urls.filter((u) => /\/engine\/|\.wasm|worker\.js|client\.mjs/.test(u))).toEqual([]);
    expect(urls.length).toBeGreaterThan(3);
  });
});

test.describe("claims policy", () => {
  test("no route mentions PostgreSQL or renders a conformance badge", async ({ page }) => {
    for (const route of ROUTES) {
      await page.goto(route);
      const text = await page.locator("body").innerText();
      expect(text, route).not.toMatch(/postgres/i);
      expect(await page.locator('[data-testid="pg-badge"]').count(), route).toBe(0);
      expect(text, route).not.toMatch(/\bconformance\b/i);
    }
  });
});

test.describe("theme toggle", () => {
  test("cycles system, light, dark, remembers the choice, and works without localStorage", async ({ page, context }) => {
    const w = await watchPage(page);
    await page.goto("/");
    const toggle = page.getByTestId("theme-toggle");
    await expect(toggle).toHaveText("Theme: System");
    await toggle.click();
    await expect(toggle).toHaveText("Theme: Light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByTestId("theme-toggle")).toHaveText("Theme: Dark");
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    await expectClean(page, w);

    // Storage blocked entirely: the page still renders and the toggle still works for this visit.
    const blocked = await context.newPage();
    await blocked.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new Error("storage blocked"); } });
    });
    const w2 = await watchPage(blocked);
    await blocked.goto("/");
    await expect(blocked.getByTestId("habitat-map")).toBeVisible();
    await blocked.getByTestId("theme-toggle").click();
    await expect(blocked.locator("html")).toHaveAttribute("data-theme", "light");
    await expectClean(blocked, w2);
  });
});

test.describe("static files", () => {
  test("404 page, sitemap and robots", async ({ page, request }) => {
    const r = await page.goto("/definitely-not-a-page");
    expect(r?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();

    const sm = await (await request.get("/sitemap.xml")).text();
    expect(sm.match(/<loc>/g)?.length).toBe(3 + SLUGS.length);
    expect(sm).toContain("/playground");
    expect(sm).not.toContain("/og/"); // share-image render targets are not pages to index
    for (const slug of SLUGS) expect(sm).toContain(`/anomalies/${slug}`);
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toMatch(/Allow: \//);
    expect(robots).toMatch(/Sitemap: https:\/\/.+\/sitemap\.xml/);
  });

  test("the About page limits, privacy and engine hash", async ({ page }) => {
    await page.goto("/about");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("About Anomaly Zoo");
    await expect(page.locator("#limits li")).toHaveCount(5);
    await expect(page.locator("main").getByText("No cookies, no analytics, no third-party requests")).toBeVisible();
    await expect(page.getByTestId("wasm-hash")).toHaveText(/^[0-9a-f]{64}$/);
  });
});
