import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEVELS, SLUGS, expectClean, watchPage } from "./helpers";

// J4: what the site says about PostgreSQL is exactly what conformance.json
// says. The expectations are computed from the file in this test, with their
// own formatting code, so a UI that hard-coded a number would fail here.
type Cell = { invariant: string };
type Level = { engine: Cell; postgres: Cell & { aborts: Record<string, string> }; classMatch: boolean; identical: boolean };
const conf = JSON.parse(readFileSync(join(process.cwd(), "public", "conformance.json"), "utf8")) as {
  engineVersion: string;
  postgresVersion: string;
  corpus: { seedBase: number; randomPerLevel: number };
  harness: { stabilityUnstable: number; stabilityPairs: number; evaluations: number };
  canned: { scenario: string; title: string; levels: Record<string, Level> }[];
  readUncommitted: { dirtyReadObserved: boolean };
  random: Record<string, Record<string, number>>;
  knownDivergences: { id: string; title: string; cause: string; regression: string; schedule: string }[];
};

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);
const word = (inv: string) => (inv === "violated" ? "Occurs" : inv === "holds" ? "Prevented" : "Not evaluated");
const PG_LEVELS = ["RC", "SI", "SER"] as const;

test.describe("J4: the About page numbers equal conformance.json", () => {
  test("versions, corpus and per-level totals", async ({ page }) => {
    const w = await watchPage(page);
    await page.goto("/about");
    const sec = page.getByTestId("conformance");
    await expect(sec).toBeVisible();
    await expect(page.getByTestId("conf-engine-version")).toHaveText(conf.engineVersion);
    await expect(page.getByTestId("conf-pg-version")).toHaveText(conf.postgresVersion);
    await expect(page.getByTestId("conf-random-per-level")).toHaveText(String(conf.corpus.randomPerLevel));
    for (const lv of PG_LEVELS) {
      const t = conf.random[lv]!;
      const row = page.getByTestId("conf-random").locator(`tr[data-level="${lv}"]`);
      await expect(row.locator('[data-field="schedules"]')).toHaveText(String(t.schedules));
      await expect(row.locator('[data-field="compared"]')).toHaveText(String(t.compared));
      await expect(row.locator('[data-field="identical"]')).toHaveText(`${t.identical} (${pct(t.identical!, t.compared!)})`);
      await expect(row.locator('[data-field="no-race"]')).toHaveText(`${t.noRaceIdentical} of ${t.noRaceCompared} (${pct(t.noRaceIdentical!, t.noRaceCompared!)})`);
      await expect(row.locator('[data-field="deadlock"]')).toHaveText(`${t.deadlockClassAgreed} of ${t.deadlockSchedules}`);
    }
    await expectClean(page, w);
  });

  test("Serializable statistics and the harness self-check", async ({ page }) => {
    await page.goto("/about");
    const s = conf.random["SER"]!;
    const ser = page.getByTestId("conf-ser");
    await expect(ser.locator('[data-field="engine-ser"]')).toHaveText(String(s.engineSerializable));
    await expect(ser.locator('[data-field="pg-ser"]')).toHaveText(String(s.postgresSerializable));
    await expect(ser.locator('[data-field="abort-identical"]')).toHaveText(String(s.abortSetsIdentical));
    await expect(ser.locator('[data-field="engine-more"]')).toHaveText(String(s.engineAbortsMore));
    await expect(ser.locator('[data-field="engine-fewer"]')).toHaveText(String(s.engineAbortsFewer));
    await expect(page.getByTestId("conf-harness")).toContainText(`${conf.harness.stabilityUnstable} of ${conf.harness.stabilityPairs} cases`);
    await expect(page.getByTestId("conf-harness")).toContainText(`${conf.harness.evaluations} comparisons`);
  });

  test("every canned cell shows the outcome conformance.json records, for the engine and for PostgreSQL", async ({ page }) => {
    await page.goto("/about");
    expect(conf.canned.map((c) => c.scenario).sort()).toEqual([...SLUGS].sort());
    for (const c of conf.canned) {
      for (const lv of PG_LEVELS) {
        const cell = c.levels[lv]!;
        const td = page.getByTestId("conf-canned").locator(`tr[data-scenario="${c.scenario}"] td[data-level="${lv}"]`);
        await expect(td, `${c.scenario}@${lv}`).toContainText(new RegExp(`Engine\\s+\\S\\s*${word(cell.engine.invariant)}`));
        await expect(td, `${c.scenario}@${lv}`).toContainText(new RegExp(`PostgreSQL\\s+\\S\\s*${word(cell.postgres.invariant)}`));
        if (cell.classMatch) await expect(td).not.toContainText("(differs)");
        else await expect(td).toContainText("(differs)");
      }
    }
  });

  test("every measured difference is listed with its cause and its smallest schedule, as text", async ({ page }) => {
    await page.goto("/about");
    const list = page.getByTestId("conf-divergences");
    for (const d of conf.knownDivergences) {
      const item = list.locator(`li[data-divergence="${d.id}"]`);
      await expect(item).toContainText(d.title);
      await expect(item).toContainText(d.cause);
      await expect(item.locator("pre")).toHaveText(d.schedule.trimEnd(), { useInnerText: false });
    }
    expect(await list.locator("li").count()).toBe(conf.knownDivergences.length);
  });

  test("Read Uncommitted is described as measured", async ({ page }) => {
    await page.goto("/about");
    const ru = page.getByTestId("conf-ru");
    if (conf.readUncommitted.dirtyReadObserved) await expect(ru).toContainText("showed a dirty read");
    else await expect(ru).toContainText("PostgreSQL has no read-uncommitted");
  });
});

test.describe("J4: the PostgreSQL badge on each anomaly page equals conformance.json", () => {
  for (const slug of SLUGS) {
    test(`${slug}, at every level`, async ({ page }) => {
    const w = await watchPage(page);
    {
      const entry = conf.canned.find((c) => c.scenario === slug)!;
      for (const lv of LEVELS) {
        await page.goto(`/anomalies/${slug}?level=${lv}`);
        await expect(page.getByTestId("viewer")).toHaveAttribute("data-ready", "true");
        await expect(page.getByTestId("viewer")).toHaveAttribute("data-level", lv);
        const badge = page.getByTestId("pg-badge");
        if (lv === "RU") {
          if (conf.readUncommitted.dirtyReadObserved) {
            await expect(badge, `${slug}@RU`).toHaveCount(0);
          } else {
            await expect(badge, `${slug}@RU`).toHaveAttribute("data-kind", "no-read-uncommitted");
            await expect(page.getByTestId("pg-badge-headline")).toHaveText("PostgreSQL has no read-uncommitted");
          }
          continue;
        }
        const cell = entry.levels[lv]!;
        await expect(badge, `${slug}@${lv}`).toHaveAttribute("data-kind", "measured");
        await expect(badge).toHaveAttribute("data-pg-outcome", cell.postgres.invariant === "violated" ? "occurs" : "prevented");
        await expect(badge).toContainText(word(cell.postgres.invariant));
        await expect(badge).toContainText(conf.postgresVersion);
        for (const id of Object.keys(cell.postgres.aborts)) await expect(badge).toContainText(`PostgreSQL aborted ${id}`);
      }
    }
    await expectClean(page, w);
    });
  }
});
