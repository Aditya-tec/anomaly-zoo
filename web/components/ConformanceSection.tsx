import { PG_LEVELS, percent, type ConfCannedLevel, type Conformance, type PgLevel } from "@/lib/conformance";
import { LEVEL_NAMES } from "@/lib/levels";
import { outcomeFromInvariant, outcomeLabel, outcomeTone } from "@/lib/outcomes";

// The "Comparison with PostgreSQL" section of the About page. Every number
// and every outcome is read from conformance.json; nothing here is typed in.

function OutcomeCell({ invariant }: { invariant: string }) {
  const o = outcomeFromInvariant(invariant);
  const l = outcomeLabel(o);
  return (
    <span className={`tone-text tone-${outcomeTone(o)}`}>
      <span aria-hidden="true">{l.glyph} </span>
      {l.text}
    </span>
  );
}

function CannedCell({ cell }: { cell: ConfCannedLevel | undefined }) {
  if (!cell) return <span>–</span>;
  return (
    <span data-match={cell.classMatch ? "same" : "different"} data-pg-invariant={cell.postgres.invariant} data-engine-invariant={cell.engine.invariant}>
      <span className="text-muted">Engine </span>
      <OutcomeCell invariant={cell.engine.invariant} />
      <span className="text-muted">, PostgreSQL </span>
      <OutcomeCell invariant={cell.postgres.invariant} />
      {cell.classMatch ? null : <strong> (differs)</strong>}
    </span>
  );
}

export function ConformanceSection({ conf }: { conf: Conformance }) {
  const ser = conf.random.SER;
  const levels: readonly PgLevel[] = PG_LEVELS;
  const n = conf.corpus.randomPerLevel;
  const cannedCells = conf.canned.flatMap((c) => levels.map((l) => c.levels[l]).filter((x): x is ConfCannedLevel => x !== undefined));
  const cannedSame = cannedCells.filter((c) => c.classMatch).length;
  const cannedIdentical = cannedCells.filter((c) => c.identical).length;

  return (
    <section id="conformance" aria-labelledby="conf-h" className="mt-10 scroll-mt-4" data-testid="conformance">
      <h2 id="conf-h" className="m-0 mb-2 text-2xl font-semibold">
        Comparison with PostgreSQL
      </h2>
      <p>
        The same schedules were run on this engine (version{" "}
        <span className="mono" data-testid="conf-engine-version">
          {conf.engineVersion}
        </span>
        ) and on PostgreSQL{" "}
        <span className="mono" data-testid="conf-pg-version">
          {conf.postgresVersion}
        </span>
        . Read Committed, Snapshot Isolation (run as PostgreSQL&apos;s Repeatable Read) and Serializable are compared: the {conf.canned.length} canned scenarios first, then{" "}
        <span data-testid="conf-random-per-level">{n}</span> random schedules per level (seeds {conf.corpus.seedBase} to {conf.corpus.seedBase + n - 1}, no DELETE). Every mismatch is re-run {conf.harness.reruns} times on PostgreSQL before it is classified.
      </p>

      <h3 className="mt-6 mb-2 text-lg font-semibold">The canned scenarios</h3>
      <p className="mt-0" data-testid="conf-canned-summary">
        The outcome is the same on both sides in {cannedSame} of {cannedCells.length} scenario-and-level pairs; {cannedIdentical} of them are identical statement by statement, in the final state and in which transactions aborted.
      </p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Canned scenarios: engine and PostgreSQL outcomes">
        <table className="w-full border-collapse text-sm" data-testid="conf-canned">
          <caption className="sr-only">Outcome of each canned scenario on this engine and on PostgreSQL</caption>
          <thead>
            <tr>
              <th scope="col" className="border border-line p-2 text-left">
                Scenario
              </th>
              {levels.map((l) => (
                <th key={l} scope="col" className="border border-line p-2 text-left">
                  {LEVEL_NAMES[l]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {conf.canned.map((c) => (
              <tr key={c.scenario} data-scenario={c.scenario}>
                <th scope="row" className="border border-line p-2 text-left font-medium">
                  {c.title.split(":")[0]}
                </th>
                {levels.map((l) => (
                  <td key={l} className="border border-line p-2" data-level={l}>
                    <CannedCell cell={c.levels[l]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mt-6 mb-2 text-lg font-semibold">Random schedules</h3>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Random schedules per level">
        <table className="w-full border-collapse text-sm" data-testid="conf-random">
          <caption className="sr-only">Random schedules compared with PostgreSQL, per level</caption>
          <thead>
            <tr>
              <th scope="col" className="border border-line p-2 text-left">
                Level
              </th>
              <th scope="col" className="border border-line p-2 text-right">
                Schedules
              </th>
              <th scope="col" className="border border-line p-2 text-right">
                Compared strictly
              </th>
              <th scope="col" className="border border-line p-2 text-right">
                Identical
              </th>
              <th scope="col" className="border border-line p-2 text-right">
                Identical when no two statements were blocked at once
              </th>
              <th scope="col" className="border border-line p-2 text-right">
                Deadlock: same outcome class
              </th>
            </tr>
          </thead>
          <tbody>
            {levels.map((l) => {
              const t = conf.random[l];
              return (
                <tr key={l} data-level={l}>
                  <th scope="row" className="border border-line p-2 text-left font-medium">
                    {LEVEL_NAMES[l]}
                  </th>
                  <td className="border border-line p-2 text-right" data-field="schedules">
                    {t.schedules}
                  </td>
                  <td className="border border-line p-2 text-right" data-field="compared">
                    {t.compared}
                  </td>
                  <td className="border border-line p-2 text-right" data-field="identical">
                    {t.identical} ({percent(t.identical, t.compared)})
                  </td>
                  <td className="border border-line p-2 text-right" data-field="no-race">
                    {t.noRaceIdentical} of {t.noRaceCompared} ({percent(t.noRaceIdentical, t.noRaceCompared)})
                  </td>
                  <td className="border border-line p-2 text-right" data-field="deadlock">
                    {t.deadlockClassAgreed} of {t.deadlockSchedules}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p>
        When one commit or abort releases several waiting transactions at once, PostgreSQL lets them run concurrently, while this engine serves them in arrival order. The schedules that can differ are the ones where two statements were blocked at the same time; the measured differences are listed below.
      </p>

      <h3 className="mt-6 mb-2 text-lg font-semibold">Serializable</h3>
      <ul className="m-0 list-disc space-y-1 pl-6" data-testid="conf-ser">
        <li>
          Serializable by the oracle: engine <span data-field="engine-ser">{ser.engineSerializable}</span> of {ser.schedules}, PostgreSQL <span data-field="pg-ser">{ser.postgresSerializable}</span> of {ser.schedules}.
        </li>
        <li>
          Same set of aborted transactions: <span data-field="abort-identical">{ser.abortSetsIdentical}</span> of {ser.schedules} ({percent(ser.abortSetsIdentical, ser.schedules)}).
        </li>
        <li>
          This engine aborts more than PostgreSQL: <span data-field="engine-more">{ser.engineAbortsMore}</span> ({percent(ser.engineAbortsMore, ser.schedules)}). Fewer: <span data-field="engine-fewer">{ser.engineAbortsFewer}</span> ({percent(ser.engineAbortsFewer, ser.schedules)}); in {ser.engineAbortsFewer - ser.engineAbortsFewerNotSerializable} of those the engine&apos;s history is still serializable. Different sets of the same size: {ser.abortSetsDifferSameCount}.
        </li>
      </ul>

      <h3 className="mt-6 mb-2 text-lg font-semibold">Measured differences</h3>
      {conf.knownDivergences.length === 0 ? (
        <p className="mt-0">No differences were found.</p>
      ) : (
        <ol className="m-0 space-y-4 pl-6" data-testid="conf-divergences">
          {conf.knownDivergences.map((d) => (
            <li key={d.id} data-divergence={d.id}>
              <p className="m-0 font-semibold">{d.title}</p>
              <p className="m-0 text-sm text-muted">
                Smallest schedule shows it at: {d.levels.join(", ")}. Seen in random schedules{Object.keys(d.occurrences).length > 0 ? " (count per level): " : ": none"}
                {Object.entries(d.occurrences)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([lv, k]) => `${lv} ${k}`)
                  .join("; ")}
              </p>
              <p className="m-0">{d.cause}</p>
              {d.notes ? <p className="m-0 mt-1 text-sm">{d.notes}</p> : null}
              <details className="mt-1">
                <summary className="min-h-11 cursor-pointer py-2">Smallest schedule that shows it ({d.regression})</summary>
                <pre className="mono m-0 overflow-x-auto p-3 text-sm" tabIndex={0}>{d.schedule}</pre>
              </details>
            </li>
          ))}
        </ol>
      )}

      <h3 className="mt-6 mb-2 text-lg font-semibold">Read Uncommitted</h3>
      <p className="mt-0" data-testid="conf-ru">
        {conf.readUncommitted.dirtyReadObserved
          ? `PostgreSQL showed a dirty read when asked for ${conf.readUncommitted.requested}.`
          : `PostgreSQL has no read-uncommitted. Asked for ${conf.readUncommitted.requested} on the dirty-read schedule, it showed no dirty read${conf.readUncommitted.sameHistoryAsReadCommitted ? " and produced the same history as READ COMMITTED" : ""}.`}
      </p>

      <h3 className="mt-6 mb-2 text-lg font-semibold">How reliable is the comparison?</h3>
      <p className="mt-0" data-testid="conf-harness">
        Running each canned scenario at each level {conf.harness.stabilityRepeats} times gave a different PostgreSQL history in {conf.harness.stabilityUnstable} of {conf.harness.stabilityPairs} cases. Of all {conf.harness.evaluations} comparisons, {conf.harness.rerunMismatches} were re-run, and the re-runs disagreed with each other in {conf.harness.unstableReruns} of them.
      </p>
    </section>
  );
}
