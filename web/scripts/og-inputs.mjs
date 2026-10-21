// What a share image is made from. `npm run og` records a hash of these
// inputs next to each generated PNG (public/og/inputs.json); a unit test
// recomputes them, so changing a scenario, its results or the card design
// without regenerating the images fails CI instead of shipping stale pictures.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_OG = "zoo";

export function ogSlugs(manifest) {
  return [...manifest.scenarios.map((s) => s.id), DEFAULT_OG];
}

export function ogInputsHash(root, manifest, slug) {
  const s = manifest.scenarios.find((x) => x.id === slug);
  const data = s
    ? { slug, title: s.title, cells: Object.fromEntries(Object.entries(s.traces).map(([lv, t]) => [lv, [t.invariant, t.mechanism, t.aborts]])) }
    : { slug, all: manifest.scenarios.map((x) => x.title) };
  const design = readFileSync(join(root, "app", "og", "[slug]", "page.tsx"), "utf8");
  const css = readFileSync(join(root, "app", "globals.css"), "utf8");
  const ogCss = css.slice(css.indexOf(".og-card {"), css.indexOf("/* ---------- motion"));
  return createHash("sha256").update(JSON.stringify(data)).update(design).update(ogCss).digest("hex");
}
