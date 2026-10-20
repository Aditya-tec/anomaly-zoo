import type { CSSProperties } from "react";
import type { TraceEvent } from "@/lib/types";
import { txnColorVar, txnGlyph } from "@/lib/glyphs";
import { abortSummary } from "@/lib/outcomes";
import { CrossIcon, LockIcon, QueueIcon, ResumeIcon, SkipIcon } from "./Icons";

export type EventState = "past" | "current" | "future";

export function opText(e: TraceEvent): string {
  switch (e.op) {
    case "READ":
      return `READ ${e.args.key ?? ""}`;
    case "SCAN":
      return `SCAN ${e.args.prefix ?? ""}${e.args.where ? ` WHERE ${e.args.where.cmp} ${e.args.where.value}` : ""}`;
    case "PUT": {
      const shown = e.args.expr ?? "";
      const val = e.args.value;
      return `PUT ${e.args.key ?? ""} = ${shown}${val !== undefined && String(val) !== shown ? ` (=${val})` : ""}`;
    }
    case "DELETE":
      return `DELETE ${e.args.key ?? ""}`;
    case "NOTE":
      return "NOTE";
    default:
      return e.op;
  }
}

export function resultText(e: TraceEvent): string | null {
  const r = e.result;
  if (!r || e.status !== "ok") return null;
  if (e.op === "READ") return r.absent ? "→ absent" : `→ ${r.value}`;
  if (e.op === "SCAN") return `→ ${r.count ?? 0} row${r.count === 1 ? "" : "s"}, sum ${r.sum ?? 0}`;
  return null;
}

interface Props {
  event: TraceEvent;
  state: EventState;
  col: number; // 1-based lane
  linked: boolean; // the current event resumes this blocked one
  originStep?: number; // for resumed events: the step that blocked
}

export function EventCard({ event: e, state, col, linked, originStep }: Props) {
  const style = { "--col": col, "--row": e.index + 1, "--txn": txnColorVar(e.txn) } as CSSProperties;
  const result = resultText(e);
  return (
    <li
      id={`ev-${e.index}`}
      className="event"
      style={style}
      data-state={state}
      data-status={e.status}
      data-resumed={e.resumed ? "true" : "false"}
      data-linked={linked ? "true" : "false"}
      data-testid={`event-${e.index}`}
      aria-current={state === "current" ? "step" : undefined}
    >
      <div className="meta">
        <span className="chip sm:hidden">
          <span className="g" aria-hidden="true">
            {txnGlyph(e.txn)}
          </span>
          {e.txn}
        </span>
        <span className="sr-only hidden sm:inline">{e.txn}.</span>
        <span>Step {e.index + 1}</span>
        {e.resumed ? (
          <span className="tag inline-flex items-center gap-1">
            <ResumeIcon />
            resumed{originStep ? ` from step ${originStep}` : ""}
          </span>
        ) : null}
      </div>
      <div className="op">{opText(e)}</div>
      {e.op === "NOTE" && e.note ? <div className="italic">“{e.note}”</div> : null}
      {result ? <div className="op">{result}</div> : null}
      {e.status === "blocked" ? (
        <div className="status-line">
          <LockIcon />
          <span>waiting on {e.blockedOn}</span>
        </div>
      ) : null}
      {e.status === "aborted" ? (
        <div className="status-line text-bad">
          <CrossIcon />
          <span>{e.reason === "abort_user" ? "rolled back" : `aborted: ${abortSummary(e.reason ?? "")}`}</span>
        </div>
      ) : null}
      {e.status === "skipped" ? (
        <div className="status-line">
          <SkipIcon />
          <span>skipped: its transaction already aborted</span>
        </div>
      ) : null}
      {e.status === "queued" ? (
        <div className="status-line">
          <QueueIcon />
          <span>queued behind a blocked statement</span>
        </div>
      ) : null}
    </li>
  );
}
