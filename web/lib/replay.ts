// Rebuilds the store at any step from the trace's deltas plus its periodic
// full snapshots (the same semantics as trace.Replayer in the Go engine).
import type { KeyVersions, Trace, VersionJSON } from "./types";

export type Store = Map<string, VersionJSON[]>;

function fromKeyVersions(list: KeyVersions[]): Store {
  const s: Store = new Map();
  for (const kv of list) s.set(kv.key, kv.versions);
  return s;
}

export function initialStore(trace: Trace): Store {
  const s: Store = new Map();
  for (const kv of trace.setup) s.set(kv.key, [{ writer: "T0", value: kv.value, deleted: false, commitTS: 1 }]);
  return s;
}

function applyDelta(store: Store, delta: KeyVersions[]): void {
  for (const kv of delta) {
    if (kv.versions.length === 0) store.delete(kv.key);
    else store.set(kv.key, kv.versions);
  }
}

/** The store after the first `applied` events (0 = just the setup data). */
export function storeAfterEvents(trace: Trace, applied: number): Store {
  const n = trace.steps.length;
  const upto = Math.max(0, Math.min(applied, n));
  if (upto === 0) return initialStore(trace);
  let start = -1;
  for (let j = upto - 1; j >= 0; j--) {
    if (trace.steps[j]?.storeFull) {
      start = j;
      break;
    }
  }
  const store = start >= 0 ? fromKeyVersions(trace.steps[start]?.storeFull ?? []) : initialStore(trace);
  for (let j = start + 1; j < upto; j++) applyDelta(store, trace.steps[j]?.storeAfter ?? []);
  return store;
}

/** Reference implementation: deltas only, from the setup. Used by tests to cross-check the snapshot shortcut. */
export function naiveStoreAfterEvents(trace: Trace, applied: number): Store {
  const store = initialStore(trace);
  for (let j = 0; j < Math.min(applied, trace.steps.length); j++) applyDelta(store, trace.steps[j]?.storeAfter ?? []);
  return store;
}

export function changedKeys(trace: Trace, applied: number): Set<string> {
  const e = trace.steps[applied - 1];
  return new Set((e?.storeAfter ?? []).map((kv) => kv.key));
}

/** Snapshot timestamps of each transaction as of `applied` events. */
export function snapshotsAt(trace: Trace, applied: number): { txn: string; snapshotTS: number }[] {
  const seen = new Map<string, number>();
  for (let j = 0; j < Math.min(applied, trace.steps.length); j++) {
    const e = trace.steps[j];
    if (e && e.snapshotTS > 0 && !seen.has(e.txn)) seen.set(e.txn, e.snapshotTS);
  }
  return [...seen.entries()].map(([txn, snapshotTS]) => ({ txn, snapshotTS })).sort((a, b) => a.txn.localeCompare(b.txn));
}
