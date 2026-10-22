import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RerunPanel } from "@/components/RerunPanel";
import { TraceViewer } from "@/components/TraceViewer";
import { loadAllTraces, loadConformance, loadManifest, loadScenario, loadSource } from "@/lib/data";
import { pgBadgesForScenario } from "@/lib/conformance";
import { LEVELS } from "@/lib/levels";
import { pageMetadata } from "@/lib/seo";
import { encodeShare } from "@/lib/share";
import type { Level } from "@/lib/types";
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
  return pageMetadata({ title: name, description: s.story, path: `/anomalies/${slug}`, ogSlug: slug });
}

export default async function AnomalyPage({ params }: Params) {
  const { slug } = await params;
  if (!loadManifest().scenarios.some((x) => x.id === slug)) notFound();
  const scenario = loadScenario(slug);
  const traces = loadAllTraces(slug);
  const why = WHY_LEVELS_DIFFER[slug];
  const source = loadSource(slug);
  const enc = encodeShare(source);
  if (!enc.ok) throw new Error(`canned scenario ${slug} cannot be shared as a link: ${enc.reason}`);
  const published = Object.fromEntries(LEVELS.map((lv) => [lv, traces[lv].digest])) as Record<Level, string>;

  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <p className="m-0 mb-2">
        <a href="/" className="inline-flex min-h-11 items-center">
          ← Habitat map
        </a>
      </p>
      <header className="max-w-3xl">
        <h1 className="m-0">{scenario.title}</h1>
        <p className="mt-3 mb-1 text-lg">{scenario.story}</p>
        <p className="m-0 text-sm text-muted">An illustration, not an incident report.</p>
      </header>

      <div className="mt-8">
        <TraceViewer traces={traces} defaultLevel={defaultLevelFor(scenario)} pg={pgBadgesForScenario(loadConformance(), slug)} />
      </div>

      <div className="mt-12 max-w-3xl">
        <RerunPanel source={source} published={published} playgroundHref={`/playground#s=${enc.payload}`} />
      </div>

      <div className="mt-12 grid max-w-3xl gap-8">
        {why ? (
          <section aria-labelledby="why-h">
            <h2 id="why-h" className="m-0 mb-2">
              Why the levels differ
            </h2>
            <p className="m-0">{why}</p>
          </section>
        ) : null}
        <section aria-labelledby="practice-h">
          <h2 id="practice-h" className="m-0 mb-2">
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
