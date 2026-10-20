import type { Metadata } from "next";
import { HabitatMap } from "@/components/HabitatMap";
import { loadManifest } from "@/lib/data";
import { buildHomeData } from "@/lib/home";
import { SITE_NAME, TAGLINE } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: `${SITE_NAME}: ${TAGLINE}` },
  description: "An interactive museum of database concurrency bugs, replayed step by step at four isolation levels.",
  alternates: { canonical: "/" },
};

export default function Home() {
  const data = buildHomeData(loadManifest());
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <section aria-labelledby="hero-h" className="max-w-3xl">
        <p className="eyebrow m-0 mb-2">An interactive museum of database concurrency bugs</p>
        <h1 id="hero-h" className="m-0 text-4xl font-bold sm:text-5xl">
          {TAGLINE}
        </h1>
        <p className="mt-4 mb-0 text-lg">
          A from-scratch transactional engine runs scripted schedules of two or three transactions at four isolation levels. Step through a schedule, watch a bug happen, flip the isolation level, and see the mechanism that prevents it.
        </p>
      </section>

      <section aria-labelledby="map-h" className="mt-10">
        <h2 id="map-h" className="m-0 mb-1 text-2xl font-semibold">
          Habitat map
        </h2>
        <p className="mt-0 mb-4 text-muted">Each row is a concurrency bug and each column an isolation level. Choose a cell to replay that run.</p>
        <HabitatMap data={data} />
      </section>

      <section aria-labelledby="how-h" className="mt-12 max-w-3xl">
        <h2 id="how-h" className="m-0 mb-3 text-2xl font-semibold">
          How it works
        </h2>
        <ol className="m-0 list-decimal space-y-2 pl-6">
          <li>Read the short story behind a bug.</li>
          <li>Step through the schedule and watch the transactions interleave.</li>
          <li>Flip the isolation level, replay, and compare what changed.</li>
        </ol>
      </section>

      <section aria-labelledby="limits-h" className="card mt-12 max-w-3xl p-4">
        <h2 id="limits-h" className="m-0 mb-2 text-xl font-semibold">
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
