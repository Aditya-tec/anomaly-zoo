import type { Banner } from "@/lib/outcomes";
import { outcomeLabel, outcomeTone } from "@/lib/outcomes";

export function ResultBanner({ banner }: { banner: Banner }) {
  const label = outcomeLabel(banner.outcome);
  return (
    <div className={`banner p-4 tone-${outcomeTone(banner.outcome)}`} aria-live="polite" data-testid="result-banner" data-outcome={banner.outcome}>
      <p className="m-0 text-xl font-bold">
        <span className="tone-text">
          <span aria-hidden="true">{label.glyph} </span>
          {label.text}
        </span>
        <span className="sr-only">: </span>
        <span className="ml-2 text-fg" data-testid="banner-headline">
          {banner.headline}
        </span>
      </p>
      {banner.lines.length > 0 ? (
        <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-sm">
          {banner.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
