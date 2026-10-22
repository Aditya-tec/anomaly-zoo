import { expect, test } from "@playwright/test";

// The design system's own promises: the background clip, the headline, where text shadows appear,
// the per-level meter, and that the playground editor never silently drops early typing.

const TAGLINE = "Watch database isolation bugs happen. Then turn them off.";

test.describe("background video", () => {
  test("it is a local, muted, looping clip that plays at half speed", async ({ page }) => {
    const hosts = new Set<string>();
    page.on("request", (r) => hosts.add(new URL(r.url()).host));
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    const video = page.getByTestId("bg-video");
    await expect(video).toHaveAttribute("src", "/media/ambient.mp4");
    const state = await video.evaluate((v: HTMLVideoElement) => ({ muted: v.muted, loop: v.loop, rate: v.playbackRate, inline: v.hasAttribute("playsinline"), hidden: v.getAttribute("aria-hidden") }));
    expect(state).toEqual({ muted: true, loop: true, rate: 0.5, inline: true, hidden: "true" });
    expect([...hosts]).toEqual([new URL(page.url()).host]); // nothing from another host
  });

  test("prefers-reduced-motion keeps it paused, and the page offers a way to pause and play", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const video = page.getByTestId("bg-video");
    await expect(video).toHaveAttribute("data-paused", "true");
    expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length)).toBe(0);
  });

  test("the pause button (WCAG 2.2.2) stops and restarts the clip", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    const toggle = page.getByTestId("bg-toggle");
    const video = page.getByTestId("bg-video");
    await expect(toggle).toHaveText("Stop motion");
    await toggle.click();
    await expect(video).toHaveAttribute("data-paused", "true");
    await expect(toggle).toHaveText("Resume motion");
    await toggle.click();
    await expect(video).toHaveAttribute("data-paused", "false");
  });
});

test.describe("headline and text shadows", () => {
  test("the headline is the one serif element; its DOM text is the real tagline", async ({ page }) => {
    await page.goto("/");
    const h1 = page.getByRole("heading", { level: 1 });
    expect(await h1.evaluate((el) => el.textContent)).toBe(TAGLINE);
    expect(await h1.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Fallback"); // the next/font face for Instrument Serif and its size-matched fallback
    expect(await h1.evaluate((el) => getComputedStyle(el).textShadow)).not.toBe("none");
    expect(await h1.locator("em").evaluate((el) => getComputedStyle(el).fontStyle)).toBe("italic");
    for (const route of ["/", "/about", "/playground", "/anomalies/write-skew"]) {
      await page.goto(route);
      const serif = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => getComputedStyle(el).fontFamily.includes("Fallback") && el.tagName !== "H1" && !el.closest("h1")).map((el) => el.tagName));
      expect(serif, `${route}: the serif is for the h1 only`).toEqual([]);
    }
  });

  test("the serif font is served from this site and is loaded", async ({ page }) => {
    const hosts = new Set<string>();
    page.on("request", (r) => {
      if (/\.woff2?$/.test(new URL(r.url()).pathname)) hosts.add(new URL(r.url()).host);
    });
    await page.goto("/");
    const loaded = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].filter((f) => f.status === "loaded").length;
    });
    expect(loaded).toBeGreaterThan(0);
    expect([...hosts]).toEqual([new URL(page.url()).host]);
  });

  test("shadows are for the headline and the hero line; long-form text and tables carry none", async ({ page }) => {
    for (const route of ["/", "/about", "/anomalies/write-skew"]) {
      await page.goto(route);
      const bad = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll("main p:not(.aura), main li, main dd, main dt, main td, main th, main pre, main summary, main h2, main h3")) {
          if (getComputedStyle(el).textShadow !== "none") out.push(el.tagName.toLowerCase());
        }
        return out;
      });
      expect(bad, route).toEqual([]);
    }
  });
});

test.describe("level meter", () => {
  test("each bar is a native progress element with a name and a printed figure", async ({ page }) => {
    await page.goto("/");
    const meter = page.getByTestId("level-meter");
    await expect(meter).toHaveAttribute("aria-label", /invariant holds/);
    for (const lv of ["RU", "RC", "SI", "SER"]) {
      const row = meter.locator(`[data-level="${lv}"]`);
      await expect(row).toContainText(/holds in \d+ of \d+/);
      const bar = row.locator("progress");
      await expect(bar).toHaveAttribute("aria-label", /the invariant holds in \d+ of \d+ scenarios/);
      const [value, max] = await bar.evaluate((p: HTMLProgressElement) => [p.value, p.max]);
      expect(max).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(max!);
    }
  });
});

test.describe("hydration", () => {
  test("the editor is read-only until the page hydrates, so typing early is never silently discarded", async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route("**/_next/static/chunks/*.js", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/playground", { waitUntil: "domcontentloaded" });
    const source = page.getByTestId("source");
    await expect(page.getByTestId("editor")).toHaveAttribute("data-hydrated", "false");
    await expect(source).toHaveAttribute("readonly", "");
    release();
    await expect(page.getByTestId("editor")).toHaveAttribute("data-hydrated", "true");
    await expect(source).not.toHaveAttribute("readonly", "");
    await source.fill("scenario typed-after-hydration");
    await expect(source).toHaveValue("scenario typed-after-hydration");
  });
});
