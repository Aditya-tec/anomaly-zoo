import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { LEVELS, ROUTES, SLUGS, stepCount } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

// "dark" is the default phosphor theme; "light" is the opt-in paper theme, which the
// site reads from localStorage before first paint (the OS preference no longer picks the theme).
async function setTheme(page: Page, scheme: "light" | "dark", extra: { reducedMotion?: "reduce" } = {}) {
  await page.emulateMedia({ colorScheme: scheme, ...extra });
  await page.addInitScript((paper) => {
    try {
      if (paper) window.localStorage.setItem("azoo-theme", "light");
      else window.localStorage.removeItem("azoo-theme");
    } catch {
      /* storage unavailable */
    }
  }, scheme === "light");
}

async function scan(page: Page, label: string) {
  // @axe-core/playwright bundles an older Playwright type for Page; the runtime object is the same.
  const res = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).withTags(TAGS).analyze();
  const bad = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = bad.map((v) => `${v.id} [${v.impact}] ${v.help}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(summary, `axe serious/critical on ${label}`).toEqual([]);
  // Moderate and minor are not gating but must not hide real problems; report them.
  return res.violations.filter((v) => v.impact !== "serious" && v.impact !== "critical").map((v) => `${v.id}[${v.impact}]`);
}

for (const scheme of ["light", "dark"] as const) {
  for (const route of ROUTES) {
    test(`axe: ${route} has zero serious/critical violations (${scheme}, system preference)`, async ({ page }, info: TestInfo) => {
      await setTheme(page, scheme);
      await page.goto(route);
      if (route.startsWith("/anomalies/")) await expect(page.getByTestId("viewer")).toHaveAttribute("data-ready", "true");
      const minor = await scan(page, `${route} (${scheme})`);
      if (minor.length) info.annotations.push({ type: "axe-non-gating", description: [...new Set(minor)].join(", ") });
    });
  }

  test(`axe: the 404 page has zero serious/critical violations (${scheme})`, async ({ page }) => {
    await setTheme(page, scheme);
    const notFound = await page.goto("/no-such-page");
    expect(notFound?.status()).toBe(404);
    await scan(page, `/404 (${scheme})`);
  });
  test(`axe: the theme toggle reaches ${scheme === "light" ? "paper" : "phosphor"} (${scheme})`, async ({ page }) => {
    // Reduced motion: no colour transitions, so axe never samples a half-faded colour after the toggle.
    await page.emulateMedia({ colorScheme: scheme === "light" ? "dark" : "light", reducedMotion: "reduce" }); // the OS preference must not matter
    await page.goto("/anomalies/write-skew");
    await expect(page.getByTestId("viewer")).toHaveAttribute("data-ready", "true");
    const toggle = page.getByTestId("theme-toggle");
    if (scheme === "light") await toggle.click(); // paper
    if (scheme === "light") await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    else await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    await scan(page, `toggle=${scheme}`);
  });}

// Every anomaly, every level, mid-run and at the end, in both themes: this is
// where blocked, aborted, skipped, queued and resumed cards appear.
for (const slug of SLUGS) {
  test(`axe: ${slug} at every level, mid-run and at the end (light and dark)`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "state scans run in Chromium; the other engines scan every route above");
    test.setTimeout(150_000);
    for (const scheme of ["light", "dark"] as const) {
      await setTheme(page, scheme);
      for (const lv of LEVELS) {
        const n = stepCount(slug, lv);
        for (const step of [Math.ceil(n / 2), n]) {
          await page.goto(`/anomalies/${slug}?level=${lv}&step=${step}`);
          await expect(page.getByTestId("viewer")).toHaveAttribute("data-step", String(step));
          await scan(page, `${slug}@${lv} step ${step} (${scheme})`);
        }
      }
    }
  });
}
for (const scheme of ["light", "dark"] as const) {
  test(`axe: the playground with results, with source errors and with a refused link (${scheme})`, async ({ page }) => {
    await setTheme(page, scheme, { reducedMotion: "reduce" });
    await page.goto("/playground");
    await page.getByTestId("run").click();
    await expect(page.getByTestId("result-banner")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await scan(page, `playground with results (${scheme})`);

    await page.getByTestId("source").fill("scenario x\nschedule:\n  T1 FROB\n");
    await page.getByTestId("run").click();
    await expect(page.getByTestId("source-errors")).toBeVisible();
    await scan(page, `playground with errors (${scheme})`);

    await page.getByTestId("share").click();
    await scan(page, `playground with share box (${scheme})`);

    await page.goto("about:blank");
    await page.goto("/playground#s=%25%25");
    await expect(page.getByTestId("link-error")).toBeVisible();
    await scan(page, `playground with a refused link (${scheme})`);
  });

  test(`axe: a share-image render target (${scheme})`, async ({ page }) => {
    await setTheme(page, scheme);
    await page.goto("/og/write-skew");
    await expect(page.getByTestId("og-card")).toBeVisible();
    await scan(page, `/og/write-skew (${scheme})`);
  });
}

test("axe: with the compare strip collapsed and the store drawer open on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/anomalies/read-only-anomaly?level=SER&step=6");
  await expect(page.getByTestId("viewer")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "Show" }).first().click();
  await page.getByRole("button", { name: "Collapse" }).click();
  await scan(page, "phone, drawer open, compare collapsed");
});
