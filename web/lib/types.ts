// Types for the trace JSON written by `azoo traces` (spec §5.8). The shapes
// mirror engine/trace/trace.schema.json; parse.ts checks them at build time.

export type Level = "RU" | "RC" | "SI" | "SER";

export interface Ref {
  writer: string;
  commitTS: number;
}

export interface ReadEntry {
  key: string;
  from: Ref | null;
  why: string;
}

export interface Effect {
  kind: string;
  txn?: string;
  key?: string;
  from?: string;
  to?: string;
  via?: string;
  holder?: string;
  reason?: string;
  commitTS?: number;
  value?: number;
  deleted?: boolean;
}

export interface EventArgs {
  key?: string;
  prefix?: string;
  where?: { cmp: string; value: number };
  as?: string;
  expr?: string;
  value?: number;
  text?: string;
}

export interface VersionJSON {
  writer: string;
  value: number;
  deleted: boolean;
  commitTS: number;
}

export interface KeyVersions {
  key: string;
  versions: VersionJSON[];
}

export type EventStatus = "ok" | "blocked" | "aborted" | "skipped" | "queued";

export interface EventResult {
  value?: number;
  absent?: boolean;
  rows?: { key: string; value: number }[];
  count?: number;
  sum?: number;
}

export interface TraceEvent {
  index: number;
  scheduledIndex: number;
  resumed: boolean;
  txn: string;
  op: "BEGIN" | "COMMIT" | "ABORT" | "READ" | "SCAN" | "PUT" | "DELETE" | "NOTE";
  args: EventArgs;
  status: EventStatus;
  reason?: string;
  blockedOn?: string;
  snapshotTS: number;
  stmtTS: number;
  result?: EventResult;
  reads: ReadEntry[];
  effects: Effect[];
  /** Delta: the keys this event changed, each with its complete chain (empty chain = removed). */
  storeAfter: KeyVersions[];
  /** Whole store after this event; present on every 32nd event. */
  storeFull?: KeyVersions[];
  note: string | null;
}

export interface TxnSummary {
  id: string;
  status: "committed" | "aborted";
  snapshotTS: number;
  commitTS: number;
  abortReason: string | null;
}

export interface InvariantResult {
  name: string;
  status: "holds" | "violated" | "n/a";
  detail: string;
}

export interface Trace {
  schemaVersion: 1;
  engineVersion: string;
  scenario: { id: string; title: string; story: string; invariants: { name: string; expr: string }[] };
  level: Level;
  setup: { key: string; value: number }[];
  steps: TraceEvent[];
  txns: TxnSummary[];
  finalState: { key: string; value: number }[];
  invariants: InvariantResult[];
  serializable: { verdict: boolean; witnessOrder: string[] | null };
  digest: string;
}

export interface ManifestTrace {
  file: string;
  digest: string;
  sha256: string;
  bytes: number;
  invariant: "holds" | "violated" | "n/a";
  serializable: boolean;
  aborts: Record<string, string>;
  mechanism: string;
}

export interface ManifestScenario {
  id: string;
  title: string;
  story: string;
  invariants: string[];
  traces: Record<Level, ManifestTrace>;
}

export interface Manifest {
  schemaVersion: 1;
  engineVersion: string;
  levels: Level[];
  scenarios: ManifestScenario[];
}
