import { expect, test, type Page } from "@playwright/test";
import { expectClean, watchPage } from "./helpers";

const WIDTHS = [320, 360, 375, 414, 640, 768, 1024, 1280, 1440];
const PAGES = ["/", "/anomalies/read-only-anomaly?level=SER&step=8", "/anomalies/lost-update?level=RC&step=9", "/about", "/playground"];

async function noHorizontalScroll(page: Page, label: string) {
  const m = await page.evaluate(() => {
    const client = document.documentElement.clientWidth;
    const scroll = document.documentElement.scrollWidth;
    const offenders: string[] = [];
    if (scroll > client + 1) {
      // Name what sticks out: element boxes and text that overflows its own box.
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > client + 0.5) offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")} right=${Math.round(r.right)}`);
      }
      const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        if (!n.textContent?.trim()) continue;
        const rg = document.createRange();
        rg.selectNodeContents(n);
        const r = rg.getBoundingClientRect();
        if (r.right > client + 0.5) offenders.push(`text "${n.textContent.trim().slice(0, 20)}" in ${n.parentElement?.tagName.toLowerCase()}.${String(n.parentElement?.className).split(" ").slice(0, 2).join(".")} right=${Math.round(r.right)}`);
      }
    }
    return { client, scroll, offenders: offenders.slice(0, 8) };
  });
  expect(m.scroll, `${label}: horizontal overflow (${m.scroll} > ${m.client}); sticking out: ${m.offenders.join(" | ")}`).toBeLessThanOrEqual(m.client + 1);
}
test("no horizontal scrolling from 320 px to 1440 px", async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    for (const url of PAGES) {
      await page.goto(url);
      if (url.startsWith("/anomalies")) await expect(page.getByTestId("viewer")).toHaveAttribute("data-ready", "true");
      await noHorizontalScroll(page, `${url} at ${width}px`);
    }
  }
});

test("200% and 400% zoom (a 640 px and a 320 px viewport) keep every feature usable", async ({ page }) => {
  for (const width of [640, 320]) {
    await page.setViewportSize({ width, height: 480 });
    await page.goto("/anomalies/write-skew?level=SI");
    await expect(page.getByTestId("viewer")).toHaveAttribute("data-ready", "true");
    await noHorizontalScroll(page, `zoomed ${width}`);
    for (const name of ["Back", "Next", "Play", "Reset"]) await expect(page.getByRole("button", { name })).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByTestId("step-label")).toHaveText(/^Step 1 of /);
    await expect(page.getByTestId("level-switch")).toBeVisible();
    await expect(page.getByTestId("explain-panel")).toBeVisible();
  }
});

test("map: a table at 640 px and above, cards with four chips below", async ({ page }) => {
  await page.setViewportSize({ width: 639, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("habitat-cards")).toBeVisible();
  await expect(page.getByTestId("habitat-map")).toBeHidden();
  await expect(page.getByTestId("habitat-cards").locator("> li").first().locator("a.map-cell")).toHaveCount(4);
  await page.setViewportSize({ width: 640, height: 800 });
  await expect(page.getByTestId("habitat-map")).toBeVisible();
  await expect(page.getByTestId("habitat-cards")).toBeHidden();
});

test("timeline: swimlanes on desktop, one chronological list with transaction chips on phones", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/anomalies/read-only-anomaly?level=SER&step=3");
  const xs = await page.locator(".event").evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
  expect(xs.length).toBe(3); // three lanes for T1, T2, T3
  await expect(page.locator(".timeline-head")).toBeVisible();

  await page.setViewportSize({ width: 375, height: 800 });
  await expect(page.locator(".timeline-head")).toBeHidden();
  const lefts = await page.locator(".event").evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
  expect(lefts.length).toBe(1); // a single column
  await expect(page.locator(".event").first().locator(".chip")).toBeVisible();
});

test("touch targets are at least 44 x 44 px on a phone and on desktop", async ({ page }) => {
  for (const vp of [{ width: 375, height: 800 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(vp);
    for (const url of ["/", "/anomalies/write-skew?level=SI", "/about", "/playground"]) {
      await page.goto(url);
      if (url.startsWith("/anomalies")) {
        await expect(page.getByTestId("viewer")).toHaveAttribute("data-ready", "true");
        if (vp.width < 640) await page.getByRole("button", { name: "Show" }).first().click();
      }
      const small = await page.evaluate(() => {
        const out: string[] = [];
        const sel = 'button, select, summary, input:not([type="radio"]), [role="radiogroup"] label, header a, footer a, main a.map-cell, main a[href^="/"]:not(.map-cell)';
        for (const el of document.querySelectorAll<HTMLElement>(sel)) {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.display === "none") continue;
          if (el.classList.contains("skip-link")) continue; // offscreen until focused
          if (r.width < 43.5 || r.height < 43.5) out.push(`${el.tagName} "${(el.textContent ?? "").trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        return out;
      });
      expect(small, `${url} at ${vp.width}px`).toEqual([]);
    }
  }
});

test("reduced motion: no transitions or animations; normal motion stays within 200 ms", async ({ page }) => {
  await page.goto("/anomalies/write-skew");
  await expect(page.getByTestId("viewer")).toHaveAttribute("data-ready", "true");
  const durations = () =>
    page.evaluate(() => {
      const secs = (s: string) => Math.max(...s.split(",").map((x) => (x.trim().endsWith("ms") ? parseFloat(x) / 1000 : parseFloat(x))));
      return [".btn", ".event", ".seg"].map((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { sel, t: NaN, a: NaN };
        const cs = getComputedStyle(el);
        return { sel, t: secs(cs.transitionDuration), a: secs(cs.animationDuration) };
      });
    });
  for (const d of await durations()) {
    expect(d.t, `${d.sel} transition`).toBeLessThanOrEqual(0.2);
    expect(d.a, `${d.sel} animation`).toBeLessThanOrEqual(0.2);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await durations();
  expect(reduced.some((d) => !Number.isNaN(d.t))).toBe(true);
  for (const d of reduced) {
    if (Number.isNaN(d.t)) continue;
    expect(d.t, `${d.sel} transition under reduced motion`).toBe(0);
    expect(d.a, `${d.sel} animation under reduced motion`).toBe(0);
  }
});

test("pages stay clean (no console errors) at phone size too", async ({ page }) => {
  const w = await watchPage(page);
  await page.setViewportSize({ width: 320, height: 640 });
  for (const url of PAGES) await page.goto(url);
  await expectClean(page, w);
});

test("the playground works on a phone: run, results, errors and share without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/playground");
  await noHorizontalScroll(page, "playground at 320px");
  await page.getByTestId("run").click();
  await expect(page.getByTestId("result-banner")).toBeVisible();
  await noHorizontalScroll(page, "playground with results at 320px");
  await page.getByTestId("share").click();
  await noHorizontalScroll(page, "playground with the share box at 320px");
  await page.getByTestId("source").fill("scenario x\nschedule:\n  T1 FROB\n");
  await page.getByTestId("run").click();
  await expect(page.getByTestId("source-errors")).toBeVisible();
  await noHorizontalScroll(page, "playground with errors at 320px");
  await page.setViewportSize({ width: 640, height: 480 }); // 200 % zoom
  await noHorizontalScroll(page, "playground at 200% zoom");
});
