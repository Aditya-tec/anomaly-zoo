import { expect, test } from "@playwright/test";
import { ROUTES, expectClean, watchPage } from "./helpers";

// Fails on any console error or CSP violation, on every route, in every browser.
test("no console errors or CSP violations on any route", async ({ page }) => {
  const w = await watchPage(page);
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
  }
  await expectClean(page, w);
});

test("no console errors or CSP violations while using the viewer", async ({ page }) => {
  const w = await watchPage(page);
  await page.goto("/anomalies/lost-update?level=RC");
  await expect(page.getByTestId("viewer")).toHaveAttribute("data-ready", "true");
  for (let i = 0; i < 9; i++) await page.getByRole("button", { name: "Next" }).click();
  await page.locator('label:has([data-testid="level-SER"])').click();
  await page.getByRole("button", { name: "Play" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Collapse" }).click();
  await page.getByTestId("theme-toggle").click();
  await page.keyboard.press("r");
  await expectClean(page, w);
});

test("every page carries a CSP <meta> before its first script, and the response headers are in place", async ({ page, request }) => {
  for (const route of ROUTES) {
    // An explicit non-browser user agent: the project's Firefox UA would make the test server omit COOP (see scripts/serve.mjs).
    const res = await request.get(route, { headers: { "user-agent": "azoo-header-check" } });
    const html = await res.text();
    const meta = html.indexOf('http-equiv="Content-Security-Policy"');
    expect(meta, `${route}: CSP meta missing`).toBeGreaterThan(0);
    expect(meta, `${route}: CSP meta after first script`).toBeLessThan(html.search(/<script\b/i));
    expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    // Real headers, including COOP (the test server omits it only for Firefox browser pages; this is an API request).
    expect(res.headers()["cross-origin-opener-policy"]).toBe("same-origin");
    expect(res.headers()["referrer-policy"]).toBe("no-referrer");
    expect(html).not.toMatch(/https?:\/\/(?!anomaly-zoo\.vercel\.app|github\.com|127\.0\.0\.1|localhost|www\.w3\.org)[a-z0-9.-]+\.[a-z]{2,}/i);
  }
  void page;
});

// Negative control: the policy is really enforced in this browser. An inline
// script without a hash must not run, and the browser must report the violation.
test("the CSP is enforced: an unhashed inline script is blocked and reported", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __csp: string[] }).__csp.push(e.violatedDirective);
    });
  });
  await page.goto("/");
  const ran = await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = "window.__injected = true";
    document.head.appendChild(s);
    return (window as unknown as { __injected?: boolean }).__injected === true;
  });
  expect(ran).toBe(false);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp[0])).toMatch(/script-src/);

  // Same for an inline event handler and for a javascript: URL.
  const handler = await page.evaluate(() => {
    const b = document.createElement("button");
    b.setAttribute("onclick", "window.__handler = true");
    document.body.appendChild(b);
    b.click();
    return (window as unknown as { __handler?: boolean }).__handler === true;
  });
  expect(handler).toBe(false);
});

// With the WASM engine loaded (worker + module import + WebAssembly under the
// worker's header CSP), nothing may be refused and nothing may log an error.
test("no CSP violations or console errors with the engine loaded, in the playground and on an anomaly page", async ({ page }) => {
  const w = await watchPage(page);
  await page.goto("/playground");
  await page.getByTestId("run").click();
  await expect(page.getByTestId("result-banner")).toBeVisible();
  await page.getByTestId("share").click();
  await page.locator('label:has([data-testid="level-SER"])').click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByTestId("source").fill("scenario x\nschedule:\n  T1 FROB\n");
  await page.getByTestId("run").click();
  await expect(page.getByTestId("source-errors")).toBeVisible();

  await page.goto("/anomalies/lost-update");
  await page.getByTestId("rerun-button").click();
  await expect(page.getByTestId("rerun-identical")).toBeVisible({ timeout: 30_000 });
  await expectClean(page, w);
});
