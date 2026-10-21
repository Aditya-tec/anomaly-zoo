import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SHOW_PG_BADGE, SHOW_PLAYGROUND, SHOW_CONFORMANCE_SECTION } from "@/lib/site";
import { ResultBanner } from "./ResultBanner";
import { HabitatMap } from "./HabitatMap";
import { buildHomeData } from "@/lib/home";
import { bannerFromTrace } from "@/lib/outcomes";
import { allTraces, manifest } from "../tests/fixtures";

describe("feature flags (P8: the PostgreSQL badge and the conformance section exist because conformance.json does)", () => {
  it("are all on", () => {
    expect(SHOW_PG_BADGE).toBe(true);
    expect(SHOW_CONFORMANCE_SECTION).toBe(true);
    expect(SHOW_PLAYGROUND).toBe(true);
  });
});

describe("components render outcomes from data only", () => {
  it("ResultBanner shows glyph, word and the generated headline, with a tone class", () => {
    const t = allTraces.find((x) => x.id === "write-skew" && x.level === "SI")!.trace;
    const html = renderToStaticMarkup(<ResultBanner banner={bannerFromTrace(t)} />);
    expect(html).toContain("✗");
    expect(html).toContain("Occurs");
    expect(html).toContain("Write Skew occurs at Snapshot Isolation.");
    expect(html).toContain("tone-bad");
    const ser = allTraces.find((x) => x.id === "write-skew" && x.level === "SER")!.trace;
    const html2 = renderToStaticMarkup(<ResultBanner banner={bannerFromTrace(ser)} />);
    expect(html2).toContain("✓");
    expect(html2).toContain("tone-good");
  });

  it("HabitatMap renders 32 cells x 2 layouts, each with a glyph and a word, and no PostgreSQL text (the map is the engine's)", () => {
    const html = renderToStaticMarkup(<HabitatMap data={buildHomeData(manifest)} />);
    expect(html.match(/class="map-cell /g)?.length).toBe(64);
    expect(html).not.toMatch(/postgres/i);
    expect(html).not.toContain("/playground");
    for (const m of html.matchAll(/<span class="tone-text"><span aria-hidden="true">(.)\s<\/span>([^<]+)<\/span>/g)) {
      expect(["✓", "✗", "–"]).toContain(m[1]);
      expect(["Prevented", "Occurs", "Not evaluated"]).toContain(m[2]);
    }
  });

  it("nothing is rendered with innerHTML-style props", () => {
    const html = renderToStaticMarkup(<HabitatMap data={buildHomeData(manifest)} />);
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });
});
