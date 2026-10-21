import test from "node:test";
import assert from "node:assert/strict";
import { checkText, numbersIn, recordedNumbers } from "./check-claims.mjs";

const recorded = new Set(["415", "434", "95.6", "20000", "500", "16.15"]);
const problems = (text, kind = "readme") => checkText("t.md", text, kind, recorded);

test("each banned phrase is caught", () => {
  const bad = [
    "The first interactive isolation explainer.",
    "It is the only tool that does this.",
    "The best way to learn isolation.",
    "Results match PostgreSQL exactly.",
    "This is production-ready.",
    "It behaves like a real database.",
    "It fully implements SSI.",
    "A test that proves Serializable is correct.",
    "Also tested against MySQL.",
    "Behaves like SQL Server here.",
    "Oracle Database does the same.",
  ];
  for (const s of bad) assert.ok(problems(s, "draft").some((p) => /banned phrase/.test(p)), `not caught: ${s}`);
});

test("legitimate wording passes: standard library only, first-updater-wins, serializability oracle", () => {
  const ok = [
    "A from-scratch MVCC engine in Go (standard library only).",
    "Snapshot isolation aborts the second writer (first-updater-wins).",
    "The serializability oracle accepted every history.",
    "Compared with PostgreSQL 16.15 on random schedules.",
  ];
  for (const s of ok) assert.deepEqual(problems(s, "page"), [], s);
});

test("a number that is in no recorded source is rejected, a recorded one passes", () => {
  assert.ok(problems("Identical on 99.9% of schedules [source: x]", "draft").some((p) => /not in any recorded source/.test(p)));
  assert.deepEqual(problems("Identical on 95.6% of 434 schedules [source: conformance.json]", "draft"), []);
  assert.deepEqual(problems("Identical on 415 of 434 schedules ([source](web/public/conformance.json)).", "readme"), []);
});

test("a paragraph with figures needs its citation: a link in the README, a marker in drafts", () => {
  assert.ok(problems("415 of 434 schedules were identical.", "readme").some((p) => /no link to its source/.test(p)));
  assert.ok(problems("415 of 434 schedules were identical.", "draft").some((p) => /no \[source/.test(p)));
  assert.deepEqual(problems("415 of 434 were identical. [MISSING: the link]", "draft"), []);
});

test("small counting numbers, versions, dates, hashes, code and link targets are not figures", () => {
  const t = "Four levels, 8 scenarios... see `20000` and [x](https://e.com/12345) on 2026-10-22, version 1.0.0, hash 08ae0f67cdc1.\n\n1. item\n2. item";
  assert.deepEqual(numbersIn(t).filter((n) => !["8"].includes(n)), []);
});

test("the real recorded set includes the conformance numbers", () => {
  const set = recordedNumbers();
  assert.ok(set.has("500"), "corpus size");
  assert.ok(set.size > 100);
});

test("a number cited to conformance.json must be in conformance.json, not merely somewhere in the logs", () => {
  const perSource = { conf: new Set(["43", "132"]), logs: new Set(["0", "47", "20000"]) };
  const rec = new Set(["0", "43", "132", "47", "20000"]);
  const wrong = checkText("t.md", "PostgreSQL's history varied in 47 of the 132 schedules [source: web/public/conformance.json].", "draft", rec, new Set(), perSource);
  assert.ok(wrong.some((p) => /47 is cited to conformance.json but is not in it/.test(p)), wrong.join("\n"));
  const right = checkText("t.md", "PostgreSQL's history varied in 43 of the 132 schedules [source: web/public/conformance.json].", "draft", rec, new Set(), perSource);
  assert.deepEqual(right, []);
  const logs = checkText("t.md", "0 rejected on 20,000 schedules [source: docs/PROGRESS.md, AC4.2].", "draft", rec, new Set(), perSource);
  assert.deepEqual(logs, []);
});
