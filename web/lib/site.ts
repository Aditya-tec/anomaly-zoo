// Feature flags. SHOW_PLAYGROUND became true in P7; SHOW_PG_BADGE and
// SHOW_CONFORMANCE_SECTION became true in P8, when conformance.json came to
// exist. They remain kill switches, and what they show comes only from that file.
export const SHOW_PG_BADGE = true; // P8: PostgreSQL badge, shown only from measured conformance.json data
export const SHOW_PLAYGROUND = true; // P7: /playground, share links, "Re-run in your browser"
export const SHOW_CONFORMANCE_SECTION = true; // P8: About page conformance report

export const SITE_NAME = "Anomaly Zoo";
export const TAGLINE = "Watch database isolation bugs happen. Then turn them off.";

/**
 * The production URL, the single place it is written in the web app. The
 * sitemap, robots.txt, Open Graph metadata and the share-image cards all read it.
 * To change it, run `node scripts/site-url.mjs --set https://new-host.example`
 * from the repository root: it rewrites this line and the documents that quote
 * the URL, and `--check` (run in CI) fails if any of them disagree.
 * If the share images show the old host, regenerate them with `npm run og`.
 */
export const SITE_URL = "https://anomaly-zoo.vercel.app";
/** Host part of SITE_URL, as printed on the share images. */
export const SITE_HOST = new URL(SITE_URL).host;
