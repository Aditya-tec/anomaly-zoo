"use client";

import { useMemo, useState } from "react";
import type { Trace } from "@/lib/types";
import { txnGlyph } from "@/lib/glyphs";
import { changedKeys, snapshotsAt, storeAfterEvents } from "@/lib/replay";

// Version chains per key, rebuilt from the trace's deltas and periodic full
// snapshots. Oldest version first; dashed = not committed yet.
export function StorePanel({ trace, step }: { trace: Trace; step: number }) {
  const [open, setOpen] = useState(false); // only matters on phones; desktop always shows it
  const store = useMemo(() => storeAfterEvents(trace, step), [trace, step]);
  const changed = useMemo(() => changedKeys(trace, step), [trace, step]);
  const snaps = useMemo(() => snapshotsAt(trace, step), [trace, step]);
  const keys = [...store.keys()].sort();

  return (
    <section className="card p-3" aria-labelledby="store-h" data-testid="store-panel">
      <div className="flex items-center justify-between gap-2">
        <h2 id="store-h" className="m-0 text-base font-semibold">
          Store
        </h2>
        <button type="button" className="btn sm:hidden" aria-expanded={open} aria-controls="store-body" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Show"}
        </button>
      </div>
      <div id="store-body" className={`${open ? "block" : "hidden"} sm:block`}>
        <table className="mt-2 w-full text-left text-sm">
          <caption className="sr-only">Version chains at step {step}, oldest first</caption>
          <thead>
            <tr>
              <th scope="col" className="pb-1 pr-2 text-xs font-semibold text-muted">
                Key
              </th>
              <th scope="col" className="pb-1 text-xs font-semibold text-muted">
                Versions
              </th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k} className="store-row" data-changed={changed.has(k) ? "true" : "false"}>
                <th scope="row" className="mono py-1 pr-2 pl-2 align-top font-medium">
                  {k}
                  {changed.has(k) ? <span className="sr-only"> (changed by this step)</span> : null}
                </th>
                <td className="py-1">
                  <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
                    {(store.get(k) ?? []).map((v, i) => (
                      <li key={i} className="version" data-txn={v.writer === "T0" ? "T1" : v.writer} data-uncommitted={v.commitTS === 0 ? "true" : "false"} data-deleted={v.deleted ? "true" : "false"}>
                        <span aria-hidden="true" className="txn-ink">
                          {v.writer === "T0" ? "○" : txnGlyph(v.writer)}
                        </span>
                        <span>{v.writer}</span>
                        <span>{v.deleted ? "deleted" : v.value}</span>
                        <span className="text-muted">{v.commitTS === 0 ? "uncommitted" : `@${v.commitTS}`}</span>
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 mb-0 text-xs text-muted" data-testid="snapshots">
          {snaps.length > 0 ? `Snapshots: ${snaps.map((s) => `${s.txn} @${s.snapshotTS}`).join(", ")}.` : "No transaction has taken a snapshot yet."} T0 is the setup data, committed at 1.
        </p>
      </div>
    </section>
  );
}
