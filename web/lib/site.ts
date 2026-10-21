// Feature flags. SHOW_PLAYGROUND became true in P7; SHOW_PG_BADGE and
// SHOW_CONFORMANCE_SECTION became true in P8, when conformance.json came to
// exist. They remain kill switches, and what they show comes only from that file.
export const SHOW_PG_BADGE = true; // P8: PostgreSQL badge, shown only from measured conformance.json data
export const SHOW_PLAYGROUND = true; // P7: /playground, share links, "Re-run in your browser"
export const SHOW_CONFORMANCE_SECTION = true; // P8: About page conformance report

export const SITE_NAME = "Anomaly Zoo";
export const TAGLINE = "Watch database isolation bugs happen. Then turn them off.";
