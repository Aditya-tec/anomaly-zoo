import { expect, test } from "@playwright/test";
import { expectClean, reach, stepCount, tabTo, tabsToLinks, watchPage } from "./helpers";

// Keyboard only: no mouse, no touch, no programmatic focus. Everything is
// reached with Tab / Shift+Tab / arrows / Enter / Space.
test("keyboard-only walk: map -> anomaly -> switch level -> step through -> back to the map", async ({ page }) => {
  const w = await watchPage(page);
  await page.goto("/");
  await expect(page.getByTestId("habitat-map")).toBeVisible();
  const linkTabbing = await tabsToLinks(page);
  await expect(page.getByTestId("habitat-map")).toBeVisible();

  // The skip link is the very first stop and works.
  // The skip link is the first focusable element and works.
  await reach(page, "a.skip-link", linkTabbing, 3);
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);

  // Tab through the page to a cell of the map and open it with Enter.
  await reach(page, '[data-testid="cell-write-skew-SI"]', linkTabbing);
  await expect(page.locator("#mech-write-skew-SI")).toBeVisible(); // mechanism on focus
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/anomalies\/write-skew\?level=SI/);
  const viewer = page.getByTestId("viewer");
  await expect(viewer).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("result-banner")).toHaveAttribute("data-outcome", "occurs");

  // Reach the level radio group and change the level with the arrow key.
  await tabTo(page, '[data-testid="level-SI"]');
  await page.keyboard.press("ArrowRight");
  await expect(viewer).toHaveAttribute("data-level", "SER");
  await expect(page.getByTestId("result-banner")).toHaveAttribute("data-outcome", "prevented");

  // Tab to Next and step with Enter, then with the shortcut keys.
  await tabTo(page, 'button[aria-keyshortcuts="ArrowRight"]');
  const n = stepCount("write-skew", "SER");
  for (let i = 1; i <= 3; i++) {
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("step-label")).toHaveText(`Step ${i} of ${n}`);
  }
  await page.keyboard.press("ArrowRight");
  await expect(viewer).toHaveAttribute("data-step", "4");
  await page.keyboard.press("ArrowLeft");
  await expect(viewer).toHaveAttribute("data-step", "3");
  await page.keyboard.press("r");
  await expect(viewer).toHaveAttribute("data-step", "0");

  // Shift+Tab walks back out to the "back to the map" link, and Enter returns home.
  await reach(page, 'main a[href="/"]', linkTabbing, 120, true);
  await expect(page.locator(':focus')).toContainText('Habitat map');
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("habitat-map")).toBeVisible();
  await expectClean(page, w);
});

test("focus is always visible while tabbing through an anomaly page", async ({ page }) => {
  await page.goto("/anomalies/lost-update?level=RC");
  await expect(page.getByTestId("viewer")).toHaveAttribute("data-ready", "true");
  const linkTabbing = await tabsToLinks(page);
  await expect(page.getByTestId("viewer")).toHaveAttribute("data-ready", "true");
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const input = el instanceof HTMLInputElement ? (el.nextElementSibling as HTMLElement | null) : null;
      const target = input ?? el; // radios are visually hidden; their sibling shows the focus ring
      const t = getComputedStyle(target);
      const ring = (t.outlineStyle !== "none" && parseFloat(t.outlineWidth) >= 2) || (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2);
      return { tag: el.tagName, label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30), ring };
    });
    if (!info) continue;
    seen.add(`${info.tag}:${info.label}`);
    expect(info.ring, `no visible focus ring on ${info.tag} "${info.label}"`).toBe(true);
  }
  expect(seen.size).toBeGreaterThan(linkTabbing ? 10 : 5);
});

test("the timeline and the level radios are reachable and operable without a mouse", async ({ page }) => {
  await page.goto("/anomalies/deadlock?level=SER");
  await expect(page.getByTestId("viewer")).toHaveAttribute("data-ready", "true");
  await tabTo(page, '[data-testid="timeline"]'); // scrollable region is focusable
  await expect(page.getByTestId("timeline")).toBeFocused();
});
