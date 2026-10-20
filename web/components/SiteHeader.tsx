import { SHOW_PLAYGROUND, SITE_NAME } from "@/lib/site";
import { ThemeToggle } from "./ThemeToggle";

const navLink = "inline-flex min-h-11 items-center rounded-md px-3 font-medium text-fg underline-offset-4 hover:underline";

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
        <a href="/" className="inline-flex min-h-11 items-center font-mono text-lg font-bold tracking-tight text-fg no-underline">
          {SITE_NAME}
        </a>
        <div className="flex flex-wrap items-center gap-1">
          <nav aria-label="Main">
            <ul className="m-0 flex list-none items-center gap-1 p-0">
              <li>
                <a href="/" className={navLink}>
                  Habitat map
                </a>
              </li>
              {SHOW_PLAYGROUND ? (
                <li>
                  <a href="/playground" className={navLink}>
                    Playground
                  </a>
                </li>
              ) : null}
              <li>
                <a href="/about" className={navLink}>
                  About
                </a>
              </li>
            </ul>
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
