import type { Metadata } from "next";
import { Playground } from "@/components/Playground";
import { loadExamples } from "@/lib/data";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Playground",
  description: "Write your own transaction schedule and run it at four isolation levels.",
  path: "/playground",
});

export default function PlaygroundPage() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="m-0">Playground</h1>
      <p className="mt-3 mb-8 max-w-3xl text-lg">
        Edit a schedule, run it at all four isolation levels, and share the link. The engine is loaded when you first run something.
      </p>
      <Playground examples={loadExamples()} />
    </main>
  );
}
