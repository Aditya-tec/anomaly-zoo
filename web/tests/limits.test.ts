import { describe, expect, it } from "vitest";
import { MAX_KEYS, MAX_SOURCE_BYTES, MAX_STEPS, MAX_TXNS, checkSourceLimits, utf8Length } from "@/lib/limits";
import { examples } from "./fixtures";

const sched = (lines: string[]) => `scenario s\nschedule:\n${lines.map((l) => "  " + l).join("\n")}\n`;

describe("source limits (spec §4.10), checked before the worker is called", () => {
  it("accepts every canned scenario", () => {
    expect(examples.length).toBe(8);
    for (const e of examples) expect(checkSourceLimits(e.source), e.id).toBeNull();
  });

  it("the byte limit counts UTF-8 bytes, exactly at the boundary", () => {
    const pad = (n: number) => "#" + "x".repeat(n - 1);
    expect(checkSourceLimits(pad(MAX_SOURCE_BYTES))).toBeNull();
    expect(checkSourceLimits(pad(MAX_SOURCE_BYTES + 1))).toMatch(/8,193 bytes; the limit is 8,192/);
    // 4096 two-byte characters is exactly 8192 bytes; one more is over.
    expect(utf8Length("é".repeat(4096))).toBe(8192);
    expect(checkSourceLimits("#" + "é".repeat(4095) + "\n")).toBeNull();
    expect(checkSourceLimits("é".repeat(4097))).toMatch(/limit is 8,192/);
  });

  it("rejects control characters but allows tabs and line breaks", () => {
    expect(checkSourceLimits("a\u0000b")).toMatch(/control characters/);
    expect(checkSourceLimits("a\u001bb")).toMatch(/control characters/);
    expect(checkSourceLimits("a\u007fb")).toMatch(/control characters/);
    expect(checkSourceLimits("a\tb\r\nc\n")).toBeNull();
  });

  it("limits the number of steps", () => {
    const ok = sched(Array.from({ length: MAX_STEPS }, () => "T1 NOTE \"x\""));
    expect(checkSourceLimits(ok)).toBeNull();
    const over = sched(Array.from({ length: MAX_STEPS + 1 }, () => "T1 NOTE \"x\""));
    expect(checkSourceLimits(over)).toMatch(/201 steps; the limit is 200/);
  });

  it("limits the number of transactions", () => {
    const six = sched(["T1 BEGIN", "T2 BEGIN", "T3 BEGIN", "T4 BEGIN", "T5 BEGIN", "T6 BEGIN"]);
    expect(checkSourceLimits(six)).toBeNull();
    expect(checkSourceLimits(sched(["T1 BEGIN", "T2 BEGIN", "T3 BEGIN", "T4 BEGIN", "T5 BEGIN", "T6 BEGIN", "T7 BEGIN"]))).toMatch(new RegExp(`${MAX_TXNS + 1} transactions`));
  });

  it("limits the number of distinct keys, counting setup lines too", () => {
    const keys = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`);
    const ok = `scenario s\nsetup:\n${keys(MAX_KEYS).map((k) => `  PUT ${k} = 1`).join("\n")}\nschedule:\n  T1 BEGIN\n  T1 COMMIT\n`;
    expect(checkSourceLimits(ok)).toBeNull();
    const over = `scenario s\nsetup:\n${keys(MAX_KEYS + 1).map((k) => `  PUT ${k} = 1`).join("\n")}\nschedule:\n  T1 BEGIN\n  T1 COMMIT\n`;
    expect(checkSourceLimits(over)).toMatch(/65 distinct keys/);
    const viaReads = sched(["T1 BEGIN", ...keys(MAX_KEYS + 1).map((k) => `T1 READ ${k} AS v${k}`), "T1 COMMIT"]);
    expect(checkSourceLimits(viaReads)).toMatch(/distinct keys/);
  });

  it("ignores things that merely look like steps (comments, titles)", () => {
    expect(checkSourceLimits('scenario s\ntitle "  T1 BEGIN"\n# T1 BEGIN\nschedule:\n  T1 BEGIN\n  T1 COMMIT\n')).toBeNull();
  });
});
