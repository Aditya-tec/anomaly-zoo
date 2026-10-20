import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

// Runs the project's real ESLint config on snippets, so these tests fail if the
// rules are ever weakened or mis-scoped.
const eslint = new ESLint({ cwd: process.cwd() });

async function messages(code: string, filePath: string): Promise<string[]> {
  const [r] = await eslint.lintText(code, { filePath });
  return (r?.messages ?? []).filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message);
}

describe("lint rules (spec §9.2, §10.1)", () => {
  const outcome = /Outcome words/;

  it("rejects a hand-authored outcome string in a component", async () => {
    expect((await messages('export const label = "Prevented";\n', "components/x.tsx")).some((m) => outcome.test(m))).toBe(true);
    expect((await messages("export const label = `it occurs at ${1}`;\n", "components/x.tsx")).some((m) => outcome.test(m))).toBe(true);
    expect((await messages("export const A = () => <span>Occurs</span>;\n", "components/x.tsx")).some((m) => outcome.test(m))).toBe(true);
    expect((await messages('export const label = "Occur";\n', "app/page.tsx")).some((m) => outcome.test(m))).toBe(true);
  });

  it("allows the same words in lib/outcomes.ts, the single generator", async () => {
    expect((await messages('export const label = "Prevented";\n', "lib/outcomes.ts")).some((m) => outcome.test(m))).toBe(false);
  });

  it("does not trip on unrelated words", async () => {
    expect(await messages('export const s = "Prevention is not a keyword here, nor is preventative";\n', "components/x.tsx")).toEqual([]);
  });

  it("rejects innerHTML and dangerouslySetInnerHTML", async () => {
    expect((await messages("export const f = (el: HTMLElement) => { el.innerHTML = 'x'; };\n", "components/x.tsx")).length).toBeGreaterThan(0);
    expect((await messages("export const A = () => <div dangerouslySetInnerHTML={{ __html: 'x' }} />;\n", "components/x.tsx")).length).toBeGreaterThan(0);
    expect((await messages("export const f = (el: HTMLElement) => el.insertAdjacentHTML('beforeend', 'x');\n", "components/x.tsx")).length).toBeGreaterThan(0);
  });

  it("rejects eval and new Function", async () => {
    const [r] = await eslint.lintText('export const f = () => eval("1");\n', { filePath: "lib/x.ts" });
    expect(r?.messages.some((m) => m.ruleId === "no-eval")).toBe(true);
    const [r2] = await eslint.lintText('export const g = () => new Function("return 1");\n', { filePath: "lib/x.ts" });
    expect(r2?.messages.some((m) => m.ruleId === "no-new-func")).toBe(true);
  });
});
