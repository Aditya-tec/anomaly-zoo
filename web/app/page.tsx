import type { Metadata } from "next";
import { HabitatMap } from "@/components/HabitatMap";
import { LevelMeter } from "@/components/LevelMeter";
import { loadManifest } from "@/lib/data";
import { buildHomeData, levelTotals } from "@/lib/home";
import { pageMetadata } from "@/lib/seo";
import { SITE_NAME, TAGLINE } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: `${SITE_NAME}: ${TAGLINE}`,
  absoluteTitle: true,
  description: "An interactive museum of database concurrency bugs, replayed step by step at four isolation levels.",
  path: "/",
});

export default function Home() {
  const data = buildHomeData(loadManifest());
  return (
    <main id="main" tabIndex={-1} className="relative z-10 mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <section aria-labelledby="hero-h" className="flex min-h-[min(60vh,34rem)] flex-col items-center justify-center py-10 text-center">
        <p className="eyebrow m-0 mb-4">An interactive museum of database concurrency bugs</p>
        <h1 id="hero-h" className="m-0 mb-4 max-w-4xl">
          Watch database isolation bugs happen. Then turn them <em>off.</em>
        </h1>
        <p className="aura mt-0 mb-10 max-w-2xl text-sm leading-relaxed text-white/80 sm:text-base">
          A from-scratch transactional engine runs scripted schedules of two or three transactions at four isolation levels. Step through a schedule, watch a bug happen, flip the isolation level, and see the mechanism that prevents it.
        </p>
        <div className="liquid-glass flex w-full max-w-xl items-center justify-between gap-3 rounded-full py-1.5 pr-1.5 pl-6 text-left">
          <p className="m-0 text-sm text-muted">
            {data.rows.length} bugs, 4 isolation levels
          </p>
          <a href="#map-h" className="btn btn-primary no-underline">
            Explore the map
          </a>
        </div>
      </section>

      <section aria-labelledby="map-h" className="mt-10 scroll-mt-6">
        <h2 id="map-h" className="m-0 mb-1">
          Habitat map
        </h2>
        <p className="mt-0 mb-4 text-muted">Each row is a concurrency bug and each column an isolation level. Choose a cell to replay that run.</p>
        <HabitatMap data={data} />
      </section>

      <section aria-labelledby="meter-h" className="mt-12 max-w-3xl">
        <h2 id="meter-h" className="m-0 mb-1">
          This engine, by level
        </h2>
        <p className="mt-0 mb-4 text-muted">Counted from the map above: in how many of the {data.rows.length} scenarios the invariant holds at each level of this teaching engine. A summary of these runs, not a claim about any database.</p>
        <LevelMeter totals={levelTotals(data)} />
      </section>

      <section aria-labelledby="how-h" className="mt-12 max-w-3xl">
        <h2 id="how-h" className="m-0 mb-3">
          How it works
        </h2>
        <ol className="m-0 list-decimal space-y-2 pl-6">
          <li>Read the short story behind a bug.</li>
          <li>Step through the schedule and watch the transactions interleave.</li>
          <li>Flip the isolation level, replay, and compare what changed.</li>
        </ol>
      </section>

      <section aria-labelledby="limits-h" className="card mt-12 max-w-3xl p-4">
        <h2 id="limits-h" className="m-0 mb-2">
          A teaching engine, not a database
        </h2>
        <p className="m-0">
          Keys hold integers, interleavings are a deterministic simulation rather than real concurrency, and the Serializable level is a simplified version. Your own database&apos;s documentation is the authority on how it behaves.{" "}
          <a href="/about#limits" className="inline-flex min-h-11 items-center">
            Read the limits
          </a>
          .
        </p>
      </section>
    </main>
  );
}
