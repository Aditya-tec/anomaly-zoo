import type { Metadata } from "next";
import { ConformanceSection } from "@/components/ConformanceSection";
import { loadConformance, loadConformance10k, loadEngineInfo } from "@/lib/data";
import { SHOW_CONFORMANCE_SECTION } from "@/lib/site";
import { pageMetadata } from "@/lib/seo";
import { LEVELS, LEVEL_DEFINITIONS, LEVEL_NAMES } from "@/lib/levels";

export const metadata: Metadata = pageMetadata({
  title: "About",
  description: "How Anomaly Zoo works, what it can and cannot tell you, and what it does not collect.",
  path: "/about",
});

// Limits, from spec §13.3. Items 3 and 4 make PostgreSQL statements, each backed by the
// measured comparison below (conformance.json); see docs/COPY-TODO.md.
const limits = (pgHasNoReadUncommitted: boolean): readonly string[] => [
  "A key–integer model with prefix scans; no SQL, indexes, or durability.",
  "A deterministic single-threaded simulation of interleavings, not real concurrency.",
  pgHasNoReadUncommitted
    ? "Read Uncommitted is included for teaching, to show dirty reads. PostgreSQL has no read-uncommitted; the comparison below shows what it does when asked for it."
    : "Read Uncommitted is included for teaching, to show dirty reads.",
  "The Serializable level is a simplified version: its predicate locks are per key prefix and it has no read-only optimization. The comparison below measures how its aborts differ from PostgreSQL's.",
  "Vendor behaviors differ; this explains concepts and does not replace your database's documentation.",
];

export default function AboutPage() {
  const engine = loadEngineInfo();
  const conf = loadConformance();
  const headline = loadConformance10k();
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="m-0">About Anomaly Zoo</h1>

      <section aria-labelledby="method-h" className="mt-8">
        <h2 id="method-h" className="m-0 mb-2">
          Methodology
        </h2>
        <p>Anomaly Zoo is a from-scratch MVCC engine written in Go using only the standard library. It runs scripted schedules of two or three transactions at four isolation levels and records every step as a trace.</p>
        <p>The habitat map is computed by running the engine and is asserted against expected results in continuous integration. These pages replay those recorded traces; the engine itself does not run in your browser here.</p>
        <h3 className="mt-6 mb-2">The four levels</h3>
        <dl className="m-0 space-y-3">
          {LEVELS.map((lv) => (
            <div key={lv}>
              <dt className="font-semibold">
                {LEVEL_NAMES[lv]} <span className="mono text-muted">({lv})</span>
              </dt>
              <dd className="m-0">{LEVEL_DEFINITIONS[lv]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="limits" aria-labelledby="limits-h" className="mt-10 scroll-mt-4">
        <h2 id="limits-h" className="m-0 mb-2">
          Limits
        </h2>
        <ol className="m-0 list-decimal space-y-2 pl-6">
          {limits(!headline.readUncommitted.dirtyReadObserved).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ol>
      </section>

      {SHOW_CONFORMANCE_SECTION ? <ConformanceSection conf={conf} headline={headline} /> : null}

      <section aria-labelledby="faq-h" className="mt-10">
        <h2 id="faq-h" className="m-0 mb-2">
          FAQ
        </h2>
        <h3 className="mt-4 mb-1">Does this behave exactly like my database?</h3>
        <p className="m-0">Vendor behaviors differ; this explains concepts and does not replace your database&apos;s documentation. Check your own database&apos;s documentation: behavior differs between vendors and versions.</p>
        <h3 className="mt-4 mb-1">Why is Read Uncommitted included?</h3>
        <p className="m-0">{LEVEL_DEFINITIONS.RU}</p>
        <h3 className="mt-4 mb-1">Why can Serializable abort a transaction?</h3>
        <p className="m-0">{LEVEL_DEFINITIONS.SER}</p>
      </section>

      <section aria-labelledby="privacy-h" className="mt-10">
        <h2 id="privacy-h" className="m-0 mb-2">
          Privacy
        </h2>
        <p className="m-0">
          No cookies, no analytics, no third-party requests, no fingerprinting.
        </p>
      </section>

      <section aria-labelledby="verify-h" className="mt-10">
        <h2 id="verify-h" className="m-0 mb-2">
          Verify the engine build
        </h2>
        <p className="mt-0">
          The committed WebAssembly build of the engine ({engine.engineVersion}, built with {engine.goVersion}) has this SHA-256. Rebuilding it from source with the pinned Go toolchain gives the same hash.
        </p>
        <p className="mono m-0 break-all text-sm" data-testid="wasm-hash">
          {engine.wasmSha256}
        </p>
      </section>

      <section aria-labelledby="links-h" className="mt-10">
        <h2 id="links-h" className="m-0 mb-2">
          Links
        </h2>
        <ul className="m-0 list-disc pl-6">
          <li>
            <a href="https://github.com/Aditya-tec/anomaly-zoo" className="inline-flex min-h-11 items-center" rel="noopener noreferrer">
              Source code on GitHub
            </a>
          </li>
        </ul>
      </section>
    </main>
  );
}
