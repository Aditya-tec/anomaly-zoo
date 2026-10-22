import type { HomeData } from "@/lib/home";
import { LEVELS, LEVEL_NAMES } from "@/lib/levels";
import { outcomeTone } from "@/lib/outcomes";

// The map is rendered from generated data only (lib/home.ts -> manifest.json).
// Desktop: a table, rows = anomalies, columns = levels. Phones (< 640 px): one
// card per anomaly with four chips. Each cell is a link to that run and shows a
// glyph and a word, never colour alone; the mechanism appears on hover/focus.
export function HabitatMap({ data }: { data: HomeData }) {
  return (
    <>
      <div className="hidden sm:block">
        <table className="w-full border-collapse text-left" data-testid="habitat-map">
          <caption className="sr-only">Habitat map: each concurrency bug against each isolation level. Choose a cell to replay that run.</caption>
          <thead>
            <tr>
              <th scope="col" className="pb-2 text-xs font-medium uppercase tracking-widest text-muted">
                Anomaly
              </th>
              {LEVELS.map((lv) => (
                <th key={lv} scope="col" className="px-3 pb-2 text-xs font-medium uppercase tracking-widest text-muted">
                  <abbr title={LEVEL_NAMES[lv]} className="no-underline">
                    {lv}
                  </abbr>
                  <span className="sr-only"> ({LEVEL_NAMES[lv]})</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={row.id}>
                <th scope="row" className="py-3 pr-3 align-middle font-medium">
                  <span className="eyebrow mb-0.5 block">No. {String(i + 1).padStart(2, "0")}</span>
                  <a href={`/anomalies/${row.id}`} className="inline-flex min-h-11 items-center text-fg">
                    {row.name}
                  </a>
                </th>
                {row.cells.map((c) => (
                  <td key={c.level} className="py-2 align-middle">
                    <a
                      href={c.href}
                     
                      className={`map-cell tone-${outcomeTone(c.outcome)}`}
                      data-testid={`cell-${row.id}-${c.level}`}
                      data-outcome={c.outcome}
                      aria-describedby={`mech-${row.id}-${c.level}`}
                    >
                      <span className="tone-text">
                        <span aria-hidden="true">{c.label.glyph} </span>
                        {c.label.text}
                      </span>
                      <span className="sr-only"> {row.name} at {LEVEL_NAMES[c.level]}.</span>
                      <span className="mech" id={`mech-${row.id}-${c.level}`} role="tooltip">
                        {c.mechanism}
                      </span>
                    </a>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="m-0 grid list-none gap-3 p-0 sm:hidden" data-testid="habitat-cards">
        {data.rows.map((row, i) => (
          <li key={row.id} className="card map-card p-3">
            <p className="eyebrow m-0">No. {String(i + 1).padStart(2, "0")}</p>
            <h3 className="m-0 mb-2">
              <a href={`/anomalies/${row.id}`} className="inline-flex min-h-11 items-center text-fg">
                {row.name}
              </a>
            </h3>
            <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0">
              {row.cells.map((c) => (
                <li key={c.level}>
                  <a href={c.href} className={`map-cell tone-${outcomeTone(c.outcome)}`} data-outcome={c.outcome}>
                    <span className="mono text-xs text-muted">
                      {c.level}
                      <span className="sr-only"> ({LEVEL_NAMES[c.level]})</span>
                    </span>
                    <span className="tone-text">
                      <span aria-hidden="true">{c.label.glyph} </span>
                      {c.label.text}
                    </span>
                    <span className="mech-inline">{c.mechanism}</span>
                  </a>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </>
  );
}
