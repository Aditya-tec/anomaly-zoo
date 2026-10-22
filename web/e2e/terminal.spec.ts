import { expect, test } from "@playwright/test";

// The terminal look: motion, headings and glow. These guard the design system's own promises.

const TAGLINE = "Watch database isolation bugs happen. Then turn them off.";

test.describe("motion", () => {
  test("normal motion: the hero command types out and the cursors blink", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    const names = await page.evaluate(() => ({
      typing: getComputedStyle(document.querySelector(".typing")!).animationName,
      heroCursor: getComputedStyle(document.querySelector("#hero-h")!, "::after").animationName,
      brandCursor: getComputedStyle(document.querySelector(".brand")!, "::after").animationName,
    }));
    expect(names).toEqual({ typing: "type-hero", heroCursor: "blink", brandCursor: "blink" });
  });

  test("prefers-reduced-motion: no typewriter, no blinking cursor, nothing animates", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const state = await page.evaluate(() => {
      const typing = document.querySelector<HTMLElement>(".typing")!;
      const cs = (el: Element, pseudo?: string) => getComputedStyle(el, pseudo);
      const animated: string[] = [];
      for (const el of document.querySelectorAll("*")) {
        for (const pseudo of [undefined, "::before", "::after"]) {
          if (cs(el, pseudo).animationName !== "none") animated.push(`${el.tagName.toLowerCase()}${pseudo ?? ""}`);
        }
      }
      return {
        animated,
        typingName: cs(typing).animationName,
        typingFullWidth: typing.getBoundingClientRect().width >= typing.scrollWidth - 1, // the whole command is shown at once
        typingText: typing.textContent,
        running: document.getAnimations().filter((a) => a.playState === "running").length,
      };
    });
    expect(state.animated).toEqual([]);
    expect(state.typingName).toBe("none");
    expect(state.typingFullWidth).toBe(true);
    expect(state.typingText).toBe("azoo matrix scenarios");
    expect(state.running).toBe(0);
  });

  test("the typed hero command is a real azoo command", async ({ page }) => {
    await page.goto("/");
    const cmd = (await page.locator(".typing").textContent())!.trim();
    // `azoo --help` lists: run, matrix, traces, gen, version.
    expect(cmd).toMatch(/^azoo (run|matrix|traces|gen|version)\b/);
  });
});

test.describe("headings and glow", () => {
  test("headings are capitalised by CSS; the text in the DOM is the real sentence case", async ({ page }) => {
    await page.goto("/");
    const h1 = page.getByRole("heading", { level: 1 });
    expect(await h1.evaluate((el) => el.textContent)).toBe(TAGLINE);
    expect(await h1.evaluate((el) => getComputedStyle(el).textTransform)).toBe("uppercase");
    for (const route of ["/", "/about", "/playground", "/anomalies/write-skew"]) {
      await page.goto(route);
      const literal = await page.evaluate(() => [...document.querySelectorAll("h1, h2, h3")].map((h) => h.textContent ?? "").filter((t) => /[a-z]/.test(t) === false && /[A-Z]{3}/.test(t) && t !== "FAQ"));
      // No heading is stored in capitals (the acronym FAQ is the one that is capitals in the source).
      expect(literal, route).toEqual([]);
    }
  });

  test("glow is for headings and accents (the logo is decoration); paragraphs and long-form text carry none", async ({ page }) => {
    for (const route of ["/", "/about", "/anomalies/write-skew"]) {
      await page.goto(route);
      const result = await page.evaluate(() => {
        const bad: string[] = [];
        for (const el of document.querySelectorAll("main p, main li, main dd, main dt, main td, main th, main pre:not(.ascii), main summary")) {
          if (getComputedStyle(el).textShadow !== "none") bad.push(el.tagName.toLowerCase());
        }
        return { bad, heading: getComputedStyle(document.querySelector("main h1")!).textShadow };
      });
      expect(result.bad, route).toEqual([]);
      expect(result.heading, route).not.toBe("none");
    }
  });
});

test.describe("level meter", () => {
  test("the bars are decoration; the figures beside them carry the meaning", async ({ page }) => {
    await page.goto("/");
    const meter = page.getByTestId("level-meter");
    await expect(meter).toHaveAttribute("aria-label", /invariant holds/);
    await expect(meter.locator(".meter-bar").first()).toHaveAttribute("aria-hidden", "true");
    for (const lv of ["RU", "RC", "SI", "SER"]) await expect(meter.locator(`[data-level="${lv}"]`)).toContainText(/holds in \d+ of \d+/);
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
