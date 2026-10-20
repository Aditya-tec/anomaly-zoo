import { expect, test } from "@playwright/test";

// A page whose `load` event never fires leaves the browser tab spinning forever
// even if everything looks rendered. This test navigates repeatedly in every
// browser and, if `load` is late, reports exactly which requests were still
// pending, so a hung request is visible instead of a bare timeout.
for (const path of ["/", "/anomalies/write-skew", "/about"]) {
  test(`the load event fires within 10 s, every time: ${path}`, async ({ browser }) => {
    for (let i = 0; i < 6; i++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const pending = new Map<string, string>();
      page.on("request", (r) => pending.set(r.url(), `${r.resourceType()} ${r.method()}`));
      page.on("requestfinished", (r) => pending.delete(r.url()));
      page.on("requestfailed", (r) => pending.delete(r.url()));
      try {
        await page.goto(path, { waitUntil: "commit", timeout: 15_000 });
      } catch (e) {
        throw new Error(`no response to the document request on ${path} (iteration ${i}). Pending: ${JSON.stringify([...pending])}. ${String(e)}`);
      }
      let loaded = true;
      try {
        await page.waitForLoadState("load", { timeout: 10_000 });
      } catch {
        loaded = false;
      }
      if (!loaded) {
        const state = await page
          .evaluate(() => ({
            readyState: document.readyState,
            unfinished: performance.getEntriesByType("resource").filter((e) => (e as PerformanceResourceTiming).responseEnd === 0).map((e) => e.name),
            links: [...document.querySelectorAll("link[rel=preload],link[rel=stylesheet],link[rel=icon],script[src]")].map((e) => `${e.tagName.toLowerCase()} ${e.getAttribute("rel") ?? ""} ${e.getAttribute("as") ?? ""} ${e.getAttribute("href") ?? e.getAttribute("src") ?? ""}`.trim()),
          }))
          .catch((e) => ({ error: String(e) }));
        throw new Error(`load did not fire on ${path} (iteration ${i}). Pending: ${JSON.stringify([...pending])}. Page: ${JSON.stringify(state)}`);
      }
      await context.close();
    }
    expect(true).toBe(true);
  });
}
