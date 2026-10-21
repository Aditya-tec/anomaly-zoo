// Shared <head> metadata: canonical URL, Open Graph and Twitter cards. Image
// URLs are site-relative; `metadataBase` in the root layout makes them absolute.
import type { Metadata } from "next";
import { SITE_NAME } from "./site";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
/** Image used by pages that are not about one anomaly. */
export const DEFAULT_OG = "zoo";

export function pageMetadata(opts: { title: string; description: string; path: string; ogSlug?: string; absoluteTitle?: boolean }): Metadata {
  const image = `/og/${opts.ogSlug ?? DEFAULT_OG}.png`;
  const full = opts.absoluteTitle ? opts.title : `${opts.title} | ${SITE_NAME}`;
  const images = [{ url: image, width: OG_WIDTH, height: OG_HEIGHT, alt: `${opts.title}: ${SITE_NAME}` }];
  return {
    title: opts.absoluteTitle ? { absolute: opts.title } : opts.title,
    description: opts.description,
    alternates: { canonical: opts.path },
    openGraph: { type: "website", siteName: SITE_NAME, title: full, description: opts.description, url: opts.path, images },
    twitter: { card: "summary_large_image", title: full, description: opts.description, images: [image] },
  };
}
