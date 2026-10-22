import { SHOW_PLAYGROUND, SITE_NAME } from "@/lib/site";

const navLink = "nav-link inline-flex min-h-11 items-center px-3 text-sm font-medium";

// Anomaly Zoo's own mark: an open ring (the schedule) with a dot inside it (the thing being observed).
function Mark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" className="h-6 w-6">
      <path d="M12 3a9 9 0 1 0 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M17.5 3.9 21 3l-.9 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className="relative z-20 px-4 pt-4 sm:px-6 sm:pt-6">
      <nav aria-label="Main" className="liquid-glass mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[1.75rem] py-1.5 pr-1.5 pl-5 sm:rounded-full sm:pl-6">
        <a href="/" className="inline-flex min-h-11 items-center gap-2 text-lg font-semibold tracking-tight no-underline">
          <Mark />
          {SITE_NAME}
        </a>
        <ul className="m-0 flex list-none flex-wrap items-center gap-1 p-0">
          <li>
            <a href="/" className={navLink}>
              Habitat map
            </a>
          </li>
          <li>
            <a href="/about" className={navLink}>
              About
            </a>
          </li>
          {SHOW_PLAYGROUND ? (
            <li>
              <a href="/playground" className="btn btn-primary no-underline">
                Playground
              </a>
            </li>
          ) : null}
        </ul>
      </nav>
    </header>
  );
}
