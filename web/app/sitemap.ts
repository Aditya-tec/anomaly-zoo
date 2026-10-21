import type { MetadataRoute } from "next";
import { SITE_URL, loadManifest } from "@/lib/data";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  // /og/* are image render targets (noindex) and are deliberately not listed.
  const pages = ["/", "/about", "/playground", ...loadManifest().scenarios.map((s) => `/anomalies/${s.id}`)];
  return pages.map((p) => ({ url: `${SITE_URL}${p === "/" ? "" : p}` }));
}
