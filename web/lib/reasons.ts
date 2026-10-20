// Reason codes (spec §5.7) and the sentences shown for them, verbatim from
// the spec table with the placeholders (Tn, Ta, Tb) filled from the trace.
export const REASON_CODES = [
  "visible_own_write",
  "visible_committed_at_statement",
  "visible_committed_before_snapshot",
  "visible_dirty",
  "invisible_newer_than_snapshot",
  "invisible_uncommitted_other",
  "absent",
  "lock_acquired",
  "blocked_on_lock",
  "lock_granted_after_wait",
  "rw_edge_added",
  "abort_concurrent_update",
  "abort_dependencies",
  "abort_deadlock",
  "abort_user",
  "abort_runtime_error",
  "skipped_txn_aborted",
  "blocked_at_end",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export interface ReasonVars {
  key?: string;
  holder?: string;
  from?: string;
  to?: string;
}

export function isReasonCode(x: string): x is ReasonCode {
  return (REASON_CODES as readonly string[]).includes(x);
}

export function reasonText(code: string, v: ReasonVars = {}): string {
  switch (code as ReasonCode) {
    case "visible_own_write":
      return "Read its own uncommitted write.";
    case "visible_committed_at_statement":
      return "Saw the newest value committed when this statement started.";
    case "visible_committed_before_snapshot":
      return "Saw the value committed before this transaction's snapshot.";
    case "visible_dirty":
      return "Saw a value its writer has not committed. (dirty read)";
    case "invisible_newer_than_snapshot":
      return "A newer committed version exists but is hidden by the snapshot.";
    case "invisible_uncommitted_other":
      return "Another transaction's uncommitted write is hidden.";
    case "absent":
      return "The key does not exist (or is deleted) for this reader.";
    case "lock_acquired":
      return v.key ? `Took the write lock on ${v.key}.` : "Took the write lock on the key.";
    case "blocked_on_lock":
      return `Waiting: ${v.holder ?? "Tn"} holds the write lock on ${v.key ?? "this key"}.`;
    case "lock_granted_after_wait":
      return `${v.holder ?? "Tn"} finished; the lock was granted and the statement ran.`;
    case "rw_edge_added":
      return `Recorded a read→write dependency ${v.from ?? "Ta"} → ${v.to ?? "Tb"} (${v.from ?? "Ta"} read what ${v.to ?? "Tb"} changed).`;
    case "abort_concurrent_update":
      return "Aborted: could not serialize access due to a concurrent update (first updater wins).";
    case "abort_dependencies":
      return "Aborted: could not serialize access due to read/write dependencies among transactions.";
    case "abort_deadlock":
      return "Aborted: deadlock detected.";
    case "abort_user":
      return "The transaction rolled back.";
    case "abort_runtime_error":
      return "Aborted: arithmetic out of range.";
    case "skipped_txn_aborted":
      return "Skipped: this transaction already aborted.";
    case "blocked_at_end":
      return "Still waiting when the schedule ended; rolled back.";
    default:
      // A code this build does not know: show it rather than hide it.
      return `Reason: ${code}`;
  }
}
