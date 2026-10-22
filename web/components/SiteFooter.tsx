import { BackgroundToggle } from "./BackgroundToggle";

export function SiteFooter() {
  return (
    <footer className="relative z-10 mt-16 px-4 pb-10 sm:px-6">
      <div className="liquid-glass mx-auto max-w-5xl space-y-2 rounded-3xl px-6 py-5 text-sm text-muted">
        <p className="m-0">
          Anomaly Zoo is a teaching engine written from scratch, not a database. A deterministic simulation of interleavings, not real concurrency.
        </p>
        <p className="m-0">
          No cookies, no analytics, no third-party requests.{" "}
          <a href="/about#limits" className="inline-flex min-h-11 items-center">
            Read the limits
          </a>
          .
        </p>
        <BackgroundToggle />
      </div>
    </footer>
  );
}
