import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const LEVELS = ["RU", "RC", "SI", "SER"] as const;
export type Lv = (typeof LEVELS)[number];

export const SLUGS = [
  "dirty-read", "non-repeatable-read", "phantom", "lost-update", "read-skew", "write-skew", "read-only-anomaly", "deadlock",
] as const;

/** The Go engine's expected matrix: an independent source of truth for what the UI must show. */
export const expected: Record<string, Record<Lv, { invariant: "holds" | "violated" }>> = JSON.parse(
  readFileSync(join(process.cwd(), "..", "scenarios", "expected.json"), "utf8"),
).cells;

export function stepCount(slug: string, level: Lv): number {
  const t = JSON.parse(readFileSync(join(process.cwd(), "public", "traces", `${slug}.${level}.json`), "utf8"));
  return t.steps.length as number;
}

/**
 * Records everything that would make a page unhealthy: console errors and
 * warnings, uncaught exceptions, CSP violations (page and workers), failed
 * requests and HTTP errors. Call `problems()` at the end of a test.
 */
export async function watchPage(page: Page) {
  const found: string[] = [];
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} blocked ${e.blockedURI || "inline"}`);
    });
  });
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") found.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => found.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => {
    const err = r.failure()?.errorText ?? "";
    // A browser cancelling a request (navigating away, closing the page) is not a failure of the site.
    if (/ABORTED|cancel/i.test(err)) return;
    found.push(`request failed: ${r.url()} ${err}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) found.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  return {
    async problems(): Promise<string[]> {
      const csp = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => []);
      return [...found, ...csp.map((c) => `CSP violation: ${c}`)];
    },
  };
}

export async function expectClean(page: Page, watcher: Awaited<ReturnType<typeof watchPage>>) {
  expect(await watcher.problems()).toEqual([]);
  void page;
}

/** Presses Tab until `selector` has focus (keyboard-only reachability). */
export async function tabTo(page: Page, selector: string, max = 80): Promise<number> {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press("Tab");
    const hit = await page.evaluate((sel) => document.activeElement?.matches(sel) ?? false, selector);
    if (hit) return i;
  }
  throw new Error(`could not reach ${selector} with ${max} Tab presses`);
}

/** Presses Shift+Tab until selector has focus. */
export async function shiftTabTo(page: Page, selector: string, max = 80): Promise<number> {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press("Shift+Tab");
    const hit = await page.evaluate((sel) => document.activeElement?.matches(sel) ?? false, selector);
    if (hit) return i;
  }
  throw new Error(`could not reach ${selector} with ${max} Shift+Tab presses`);
}

/**
 * Does this browser move focus to links with Tab? Safari's default (and the
 * Windows build of Playwright's WebKit) does not: links need Option+Tab or a
 * preference. That is browser behaviour, not a property of the page, so tests
 * that walk through links by keyboard fall back to focusing the link directly
 * in such a browser and exercise everything after that with real key presses.
 */
export async function tabsToLinks(page: Page): Promise<boolean> {
  let found = false;
  for (let i = 0; i < 6 && !found; i++) {
    await page.keyboard.press("Tab");
    found = await page.evaluate(() => document.activeElement?.tagName === "A");
  }
  // Reload so the probe does not move the browser's sequential-focus starting point.
  await page.reload({ waitUntil: "load" });
  return found;
}

/** Tab to the element, or (if the browser never Tabs to links) focus it directly. */
export async function reach(page: Page, selector: string, linkTabbing: boolean, max = 80, backwards = false): Promise<void> {
  const isLink = await page.evaluate((s) => document.querySelector(s)?.tagName === "A", selector);
  if (isLink && !linkTabbing) {
    await page.locator(selector).first().focus();
    return;
  }
  if (backwards) await shiftTabTo(page, selector, max);
  else await tabTo(page, selector, max);
}
export const ROUTES = ["/", "/about", ...SLUGS.map((s) => `/anomalies/${s}`)];
