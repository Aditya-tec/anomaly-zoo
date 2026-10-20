
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-surface">
      <div className="mx-auto max-w-6xl space-y-2 px-4 py-6 text-sm text-muted sm:px-6">
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
      </div>
    </footer>
  );
}
