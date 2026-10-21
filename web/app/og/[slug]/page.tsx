import type { Metadata } from "next";
import { loadManifest } from "@/lib/data";
import { LEVEL_NAMES } from "@/lib/levels";
import { buildHomeData } from "@/lib/home";
import { anomalyName, outcomeTone } from "@/lib/outcomes";
import { DEFAULT_OG } from "@/lib/seo";
import { SITE_HOST, SITE_NAME, TAGLINE } from "@/lib/site";

// Render target for the 1200 x 630 share images in public/og/. `npm run og`
// screenshots these pages. They are not meant to be visited or indexed.
export const dynamicParams = false;

export function generateStaticParams() {
  return [...loadManifest().scenarios.map((s) => ({ slug: s.id })), { slug: DEFAULT_OG }];
}

export const metadata: Metadata = { title: "Share image", robots: { index: false, follow: false } };

type Params = { params: Promise<{ slug: string }> };

export default async function OgPage({ params }: Params) {
  const { slug } = await params;
  const data = buildHomeData(loadManifest());
  const row = data.rows.find((r) => r.id === slug);

  return (
    <main className="og-card" data-testid="og-card" data-slug={slug}>
      <div className="og-top">
        <span className="og-brand">{SITE_NAME}</span>
        <span className="og-url">{SITE_HOST}</span>
      </div>
      {row ? (
        <>
          <div>
            <h1 className="og-title">{anomalyName(row.title)}</h1>
            <p className="og-sub">{row.title.includes(":") ? row.title.slice(row.title.indexOf(":") + 1).trim() : ""}</p>
          </div>
          <ul className="og-levels">
            {row.cells.map((c) => (
              <li key={c.level} className={`og-level tone-${outcomeTone(c.outcome)}`}>
                <span className="og-code">{c.level}</span>
                <span className="og-name">{LEVEL_NAMES[c.level]}</span>
                <span className="og-outcome">
                  {c.label.glyph} {c.label.text}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div>
            <h1 className="og-title">{SITE_NAME}</h1>
            <p className="og-sub">{TAGLINE}</p>
          </div>
          <ul className="og-names">
            {data.rows.map((r) => (
              <li key={r.id}>{r.name}</li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
