import { describe, expect, it } from "vitest";
import { allTraces } from "./fixtures";
import { changedKeys, initialStore, naiveStoreAfterEvents, snapshotsAt, storeAfterEvents } from "@/lib/replay";

const plain = (m: Map<string, unknown>) => Object.fromEntries([...m.entries()].sort(([a], [b]) => a.localeCompare(b)));

describe("store replay (delta + periodic full snapshots)", () => {
  it("equals the delta-only reconstruction at every step of all 32 traces", () => {
    let checked = 0;
    for (const { id, level, trace } of allTraces) {
      for (let k = 0; k <= trace.steps.length; k++) {
        expect(plain(storeAfterEvents(trace, k)), `${id}@${level} step ${k}`).toEqual(plain(naiveStoreAfterEvents(trace, k)));
        checked++;
      }
    }
    expect(checked).toBe(allTraces.reduce((acc, t) => acc + t.trace.steps.length + 1, 0));
  });

  it("step 0 is the setup data, committed by T0 at timestamp 1", () => {
    const { trace } = allTraces[0]!;
    const s = initialStore(trace);
    for (const kv of trace.setup) expect(s.get(kv.key)).toEqual([{ writer: "T0", value: kv.value, deleted: false, commitTS: 1 }]);
    expect(plain(storeAfterEvents(trace, 0))).toEqual(plain(s));
  });

  it("the last step reproduces the trace's final state", () => {
    for (const { id, level, trace } of allTraces) {
      const s = storeAfterEvents(trace, trace.steps.length);
      const live = [...s.entries()]
        .map(([key, chain]) => ({ key, v: [...chain].reverse().find((x) => x.commitTS !== 0) }))
        .filter((x) => x.v && !x.v.deleted)
        .map((x) => ({ key: x.key, value: x.v!.value }))
        .sort((a, b) => a.key.localeCompare(b.key));
      expect(live, `${id}@${level}`).toEqual(trace.finalState);
    }
  });

  it("clamps out-of-range steps instead of throwing", () => {
    const { trace } = allTraces[0]!;
    expect(plain(storeAfterEvents(trace, -5))).toEqual(plain(storeAfterEvents(trace, 0)));
    expect(plain(storeAfterEvents(trace, 9999))).toEqual(plain(storeAfterEvents(trace, trace.steps.length)));
  });

  it("changedKeys and snapshotsAt report what the current event touched", () => {
    const lu = allTraces.find((t) => t.id === "lost-update" && t.level === "SI")!.trace;
    const putIdx = lu.steps.findIndex((e) => e.op === "PUT" && e.status === "ok");
    expect(changedKeys(lu, putIdx + 1).has("balance")).toBe(true);
    expect(changedKeys(lu, 0).size).toBe(0);
    expect(snapshotsAt(lu, 0)).toEqual([]);
    expect(snapshotsAt(lu, lu.steps.length).every((s) => s.snapshotTS === 1)).toBe(true);
  });
});
