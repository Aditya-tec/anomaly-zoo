
export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="m-0 text-4xl font-bold">Page not found</h1>
      <p className="mt-4 text-lg">That page is not in the zoo.</p>
      <p>
        <a href="/" className="inline-flex min-h-11 items-center">
          Back to the habitat map
        </a>
      </p>
    </main>
  );
}
