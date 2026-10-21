import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { expectClean, watchPage } from "./helpers";

// P9 (spec 10.6, 11.3, AC9.4).

/** Every page the build produced, as a URL path (cleanUrls: /about, not /about.html). */
function builtRoutes(): string[] {
  const out = join(process.cwd(), "out");
  const routes: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), `${rel}/${e.name}`);
      else if (e.name.endsWith(".html") && e.name !== "404.html" && e.name !== "_not-found.html") {
        const name = e.name === "index.html" ? "" : `/${e.name.replace(/\.html$/, "")}`;
        routes.push(`${rel}${name}` || "/");
      }
    }
  };
  walk(out, "");
  return [...new Set(routes.map((r) => (r === "" ? "/" : r)))].sort();
}

const ROUTES = builtRoutes();

test.describe("AC9.4: no console errors or CSP violations on any route", () => {
  test("every built page, in light and dark", async ({ page }) => {
    expect(ROUTES.length, "the sweep must cover every page of the build").toBeGreaterThanOrEqual(20);
    expect(ROUTES).toEqual(expect.arrayContaining(["/", "/about", "/playground", "/anomalies/write-skew", "/og/zoo"]));
    const w = await watchPage(page);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const route of ROUTES) {
        const res = await page.goto(route);
        expect(res?.status(), route).toBe(200);
        await page.waitForLoadState("networkidle");
      }
    }
    await expectClean(page, w);
  });

  test("the 404 page, in light and dark: nothing but the browser's own note about the 404 itself", async ({ page }) => {
    const w = await watchPage(page);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const nf = await page.goto("/this-page-does-not-exist");
      expect(nf?.status()).toBe(404);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    const problems = (await w.problems()).filter(
      (p) => !/^HTTP 404: .*\/this-page-does-not-exist$/.test(p) && !/^console\.error: Failed to load resource: the server responded with a status of 404/.test(p),
    );
    expect(problems).toEqual([]);
  });
});

test.describe("privacy statement (spec 10.6) and engine verification (spec 11.3)", () => {
  test("the About page says exactly: no cookies, no analytics, no third-party requests, no fingerprinting", async ({ page }) => {
    await page.goto("/about");
    await expect(page.locator("#privacy-h")).toHaveText("Privacy");
    const privacy = page.locator('section[aria-labelledby="privacy-h"]');
    expect((await privacy.innerText()).replace(/\s+/g, " ")).toContain("No cookies, no analytics, no third-party requests, no fingerprinting.");
  });

  test("the site sets no cookies and makes no request to any other origin", async ({ page, context, baseURL }) => {
    const origins = new Set<string>();
    page.on("request", (r) => origins.add(new URL(r.url()).origin));
    for (const route of ["/", "/about", "/anomalies/lost-update", "/playground"]) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
    }
    // Run the engine too (worker and WebAssembly), the only code that loads late.
    await page.goto("/anomalies/write-skew");
    await page.getByRole("button", { name: "Re-run in your browser" }).click();
    await expect(page.getByTestId("rerun-status")).toContainText(/identical|match/i, { timeout: 30000 });
    expect([...origins]).toEqual([new URL(baseURL!).origin]);
    expect(await context.cookies()).toEqual([]);
    expect(await page.evaluate(() => document.cookie)).toBe("");
  });

  test("the hash printed on the About page is the SHA-256 of the WebAssembly file that is served", async ({ page, request }) => {
    await page.goto("/about");
    const printed = (await page.getByTestId("wasm-hash").innerText()).trim();
    const info = JSON.parse(readFileSync(join(process.cwd(), "public", "engine", "engine.json"), "utf8")) as { wasm: string; wasmSha256: string };
    expect(printed).toBe(info.wasmSha256);
    const res = await request.get(`/engine/${info.wasm}`);
    expect(res.status()).toBe(200);
    expect(createHash("sha256").update(await res.body()).digest("hex")).toBe(printed);
  });
});
