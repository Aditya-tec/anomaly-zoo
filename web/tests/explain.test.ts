import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allTraces } from "./fixtures";
import { explainEvent, explainStart } from "@/lib/explain";
import { REASON_CODES, isReasonCode, reasonText } from "@/lib/reasons";

describe("reason codes", () => {
  it("match the Go engine's list in engine/trace/reasons.go exactly", () => {
    const src = readFileSync(join(process.cwd(), "..", "engine", "trace", "reasons.go"), "utf8");
    const block = src.slice(src.indexOf("var AllReasons"));
    // The Go constants map names to snake_case strings; AllReasons lists the constant names.
    const consts = new Map<string, string>();
    for (const m of src.matchAll(/^\s+(\w+)\s+=\s+"([a-z_]+)"/gm)) consts.set(m[1]!, m[2]!);
    const names = [...block.matchAll(/\b([A-Z]\w+)\b/g)].map((m) => m[1]!).filter((n) => consts.has(n));
    const goCodes = names.map((n) => consts.get(n)!);
    expect(goCodes.length).toBe(18);
    expect([...REASON_CODES].sort()).toEqual([...goCodes].sort());
  });

  it("every code has real text (never the unknown-code fallback)", () => {
    for (const code of REASON_CODES) {
      const text = reasonText(code, { key: "k", holder: "T9", from: "T1", to: "T2" });
      expect(text.length, code).toBeGreaterThan(5);
      expect(text.startsWith("Reason:"), code).toBe(false);
    }
  });

  it("spec §5.7 wording for the codes the UI relies on most", () => {
    expect(reasonText("abort_concurrent_update")).toBe("Aborted: could not serialize access due to a concurrent update (first updater wins).");
    expect(reasonText("abort_dependencies")).toBe("Aborted: could not serialize access due to read/write dependencies among transactions.");
    expect(reasonText("blocked_on_lock", { holder: "T1", key: "balance" })).toBe("Waiting: T1 holds the write lock on balance.");
    expect(reasonText("rw_edge_added", { from: "T2", to: "T1" })).toBe("Recorded a read→write dependency T2 → T1 (T2 read what T1 changed).");
    expect(reasonText("visible_dirty")).toBe("Saw a value its writer has not committed. (dirty read)");
  });

  it("an unknown code is shown, not hidden", () => {
    expect(reasonText("something_new")).toBe("Reason: something_new");
    expect(isReasonCode("something_new")).toBe(false);
  });
});

describe("explaining every event of every trace", () => {
  it("only known reason codes occur in the traces", () => {
    const unknown = new Set<string>();
    for (const { trace } of allTraces) {
      for (const e of trace.steps) {
        if (e.reason && !isReasonCode(e.reason)) unknown.add(e.reason);
        for (const r of e.reads) if (!isReasonCode(r.why)) unknown.add(r.why);
        for (const f of e.effects) if (f.reason && !isReasonCode(f.reason)) unknown.add(f.reason);
      }
    }
    expect([...unknown]).toEqual([]);
  });

  it("produces a headline for each of the events and no unknown-code fallbacks", () => {
    let n = 0;
    for (const { id, level, trace } of allTraces) {
      for (const e of trace.steps) {
        const x = explainEvent(trace, e);
        expect(x.headline.length, `${id}@${level} #${e.index}`).toBeGreaterThan(3);
        for (const d of x.details) expect(d.startsWith("Reason:"), `${id}@${level} #${e.index}: ${d}`).toBe(false);
        n++;
      }
    }
    expect(n).toBe(allTraces.reduce((acc, t) => acc + t.trace.steps.length, 0));
    expect(n).toBeGreaterThan(250);
  });

  it("lost update at RC: the blocked statement says who holds the lock; the resumed one says the lock was granted", () => {
    const tr = allTraces.find((t) => t.id === "lost-update" && t.level === "RC")!.trace;
    const blocked = tr.steps.find((e) => e.status === "blocked")!;
    expect(explainEvent(tr, blocked).details).toContain("Waiting: T1 holds the write lock on balance.");
    const resumed = tr.steps.find((e) => e.resumed && e.op === "PUT")!;
    const ex = explainEvent(tr, resumed);
    expect(ex.headline.startsWith("Resumed: ")).toBe(true);
    expect(ex.details).toContain("T1 finished; the lock was granted and the statement ran.");
  });

  it("write skew at SER: dependency edges and the doomed transaction are explained", () => {
    const tr = allTraces.find((t) => t.id === "write-skew" && t.level === "SER")!.trace;
    const all = tr.steps.flatMap((e) => explainEvent(tr, e).details);
    expect(all).toContain("Recorded a read→write dependency T2 → T1 (T2 read what T1 changed). (through doctor:)");
    expect(all.some((d) => d.includes("T2 is now doomed"))).toBe(true);
    expect(all).toContain("Aborted: could not serialize access due to read/write dependencies among transactions.");
  });

  it("explainStart lists the setup data", () => {
    const tr = allTraces.find((t) => t.id === "write-skew" && t.level === "SI")!.trace;
    expect(explainStart(tr).details[0]).toContain("doctor:alice = 1");
  });
});
