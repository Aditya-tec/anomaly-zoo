// Plain-English explanation of one trace event, assembled from the reason
// codes the engine recorded (spec §5.7) plus short factual phrases about the
// operation itself.
import type { Trace, TraceEvent } from "./types";
import { reasonText } from "./reasons";

function quote(s: string): string {
  return `"${s}"`;
}

function whereText(e: TraceEvent): string {
  const w = e.args.where;
  return w ? ` where value ${w.cmp} ${w.value}` : "";
}

/** One sentence describing what the statement tried to do. */
export function describeAttempt(e: TraceEvent): string {
  const t = e.txn;
  switch (e.op) {
    case "BEGIN":
      return `${t} begins.`;
    case "COMMIT":
      return `${t} tries to commit.`;
    case "ABORT":
      return `${t} rolls back.`;
    case "READ":
      return `${t} reads ${e.args.key ?? ""}.`;
    case "SCAN":
      return `${t} scans the keys starting with ${quote(e.args.prefix ?? "")}${whereText(e)}.`;
    case "PUT":
      return `${t} writes ${e.args.key ?? ""}${e.args.value !== undefined ? ` = ${e.args.value}` : ""}.`;
    case "DELETE":
      return `${t} deletes ${e.args.key ?? ""}.`;
    case "NOTE":
      return e.note ? `${t}: ${e.note}` : `${t} adds a note.`;
  }
}

function resultText(e: TraceEvent): string | null {
  const r = e.result;
  if (!r) return null;
  if (e.op === "READ") return r.absent ? "Result: the key is absent." : `Result: ${r.value}.`;
  if (e.op === "SCAN") {
    const rows = (r.rows ?? []).map((x) => `${x.key}=${x.value}`).join(", ");
    return `Result: ${r.count ?? 0} row${r.count === 1 ? "" : "s"}${rows ? ` (${rows})` : ""}, sum ${r.sum ?? 0}.`;
  }
  return null;
}

function blockedOnFor(trace: Trace, e: TraceEvent): string | undefined {
  const orig = trace.steps.find((x) => x.scheduledIndex === e.scheduledIndex && x.status === "blocked" && x.index < e.index);
  return orig?.blockedOn;
}

export interface Explanation {
  headline: string;
  details: string[];
}

export function explainEvent(trace: Trace, e: TraceEvent): Explanation {
  const details: string[] = [];
  const add = (s: string | null | undefined) => {
    if (s && !details.includes(s)) details.push(s);
  };

  const prefix = e.resumed ? "Resumed: " : "";
  const headline = prefix + describeAttempt(e);

  switch (e.status) {
    case "blocked":
      add(reasonText("blocked_on_lock", { holder: e.blockedOn, key: e.args.key }));
      break;
    case "queued":
      add(`${e.txn} is still waiting on an earlier statement, so this step waits its turn.`);
      break;
    case "skipped":
      add(reasonText("skipped_txn_aborted"));
      break;
    case "aborted":
      add(reasonText(e.reason ?? ""));
      break;
    default:
      break;
  }
  if (e.status === "ok") add(resultText(e));

  for (const r of e.reads) {
    const from = r.from ? ` (version by ${r.from.writer}${r.from.commitTS > 0 ? `, committed at ${r.from.commitTS}` : ", uncommitted"})` : "";
    add(`${r.key}: ${reasonText(r.why)}${from}`);
  }

  for (const f of e.effects) {
    switch (f.kind) {
      case "lock_acquired":
        add(f.reason === "lock_granted_after_wait"
          ? reasonText("lock_granted_after_wait", { holder: blockedOnFor(trace, e) })
          : reasonText("lock_acquired", { key: f.key }));
        break;
      case "version_created":
        add(f.deleted ? `Marked ${f.key} as deleted (not committed yet).` : `Wrote ${f.key} = ${f.value} (not committed yet).`);
        break;
      case "commit":
        add(`${f.txn} committed at timestamp ${f.commitTS}.`);
        break;
      case "lock_released":
        add(`Released the write lock on ${f.key}.`);
        break;
      case "rw_edge":
        add(`${reasonText("rw_edge_added", { from: f.from, to: f.to })}${f.via ? ` (through ${f.via})` : ""}`);
        break;
      case "doomed":
        add(`${f.txn} is now doomed: it will abort at its next operation. ${reasonText(f.reason ?? "")}`);
        break;
      case "abort":
        add(reasonText(f.reason ?? ""));
        break;
      default:
        break;
    }
  }
  return { headline, details };
}

/** What the explain panel says before the first event. */
export function explainStart(trace: Trace): Explanation {
  const keys = trace.setup.map((kv) => `${kv.key} = ${kv.value}`).join(", ");
  return { headline: "Before the first step.", details: keys ? [`Starting data: ${keys}.`] : ["The store starts empty."] };
}
