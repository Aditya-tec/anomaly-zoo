import type { MetadataRoute } from "next";
import { loadManifest } from "@/lib/data";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  // /og/* are image render targets (noindex) and are deliberately not listed.
  const pages = ["/", "/about", "/playground", ...loadManifest().scenarios.map((s) => `/anomalies/${s.id}`)];
  return pages.map((p) => ({ url: `${SITE_URL}${p === "/" ? "" : p}` }));
}
