import { describe, expect, it } from "vitest";
import { formatViewParams, parseViewParams } from "@/lib/urlstate";
import type { Level } from "@/lib/types";

const fallback = { level: "SI" as Level, step: 0 };
const max = (l: Level) => ({ RU: 10, RC: 11, SI: 12, SER: 13 })[l];

describe("URL state", () => {
  it("reads level and step", () => {
    expect(parseViewParams("?level=SER&step=5", fallback, max)).toEqual({ level: "SER", step: 5 });
    expect(parseViewParams("level=RC", fallback, max)).toEqual({ level: "RC", step: 0 });
    expect(parseViewParams("?step=7", fallback, max)).toEqual({ level: "SI", step: 7 });
  });

  it("ignores invalid or unknown values (defaults apply)", () => {
    expect(parseViewParams("?level=XX&step=3", fallback, max)).toEqual({ level: "SI", step: 3 });
    expect(parseViewParams("?level=si", fallback, max)).toEqual(fallback);
    expect(parseViewParams("?step=abc", fallback, max)).toEqual(fallback);
    expect(parseViewParams("?step=-1", fallback, max)).toEqual(fallback);
    expect(parseViewParams("?step=1.5", fallback, max)).toEqual(fallback);
    expect(parseViewParams("?step=99999999999", fallback, max)).toEqual(fallback);
    expect(parseViewParams("?step=13", fallback, max)).toEqual(fallback); // beyond SI's 12 events
    expect(parseViewParams("?bogus=1&level=RU", fallback, max)).toEqual({ level: "RU", step: 0 });
    expect(parseViewParams("", fallback, max)).toEqual(fallback);
  });

  it("checks the step against the chosen level, not the default one", () => {
    expect(parseViewParams("?level=SER&step=13", fallback, max)).toEqual({ level: "SER", step: 13 });
    expect(parseViewParams("?level=RU&step=13", fallback, max)).toEqual({ level: "RU", step: 0 });
  });

  it("round-trips", () => {
    const s = { level: "SER" as Level, step: 9 };
    expect(parseViewParams(formatViewParams(s), fallback, max)).toEqual(s);
    expect(formatViewParams(s)).toBe("?level=SER&step=9");
  });

  it("survives hostile input without throwing", () => {
    for (const q of ["?level=<script>alert(1)</script>", "?step=%00", "?level=SI&level=RU", "?&&&=", "?level[]=SI"]) {
      expect(() => parseViewParams(q, fallback, max)).not.toThrow();
    }
  });
});
