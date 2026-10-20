import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AnomalyViewer } from "@/components/AnomalyViewer";
import { loadAllTraces, loadManifest, loadScenario } from "@/lib/data";
import { defaultLevelFor } from "@/lib/outcomes";
import { IN_PRACTICE_CLOSING, IN_PRACTICE_INTRO, IN_PRACTICE_ITEMS, WHY_LEVELS_DIFFER } from "@/lib/why";

export const dynamicParams = false;

export function generateStaticParams() {
  return loadManifest().scenarios.map((s) => ({ slug: s.id }));
}

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const s = loadManifest().scenarios.find((x) => x.id === slug);
  if (!s) return {};
  const name = s.title.split(":")[0]?.trim() ?? s.title;
  return { title: name, description: s.story, alternates: { canonical: `/anomalies/${slug}` } };
}

export default async function AnomalyPage({ params }: Params) {
  const { slug } = await params;
  if (!loadManifest().scenarios.some((x) => x.id === slug)) notFound();
  const scenario = loadScenario(slug);
  const traces = loadAllTraces(slug);
  const why = WHY_LEVELS_DIFFER[slug];

  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <p className="m-0 mb-2">
        <a href="/" className="inline-flex min-h-11 items-center">
          ← Habitat map
        </a>
      </p>
      <header className="max-w-3xl">
        <h1 className="m-0 text-3xl font-bold sm:text-4xl">{scenario.title}</h1>
        <p className="mt-3 mb-1 text-lg">{scenario.story}</p>
        <p className="m-0 text-sm text-muted">An illustration, not an incident report.</p>
      </header>

      <div className="mt-8">
        <AnomalyViewer traces={traces} defaultLevel={defaultLevelFor(scenario)} />
      </div>

      <div className="mt-12 grid max-w-3xl gap-8">
        {why ? (
          <section aria-labelledby="why-h">
            <h2 id="why-h" className="m-0 mb-2 text-2xl font-semibold">
              Why the levels differ
            </h2>
            <p className="m-0">{why}</p>
          </section>
        ) : null}
        <section aria-labelledby="practice-h">
          <h2 id="practice-h" className="m-0 mb-2 text-2xl font-semibold">
            In practice
          </h2>
          <p className="mt-0 mb-2">{IN_PRACTICE_INTRO}</p>
          <ul className="m-0 list-disc space-y-1 pl-6">
            {IN_PRACTICE_ITEMS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <p className="mt-3 mb-0">{IN_PRACTICE_CLOSING}</p>
        </section>
      </div>
    </main>
  );
}
