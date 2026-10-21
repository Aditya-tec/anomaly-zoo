// Feature flags for things that are built but must stay hidden until a later
// phase. Nothing behind a false flag is rendered, and nothing it would link to
// exists yet. (SHOW_PLAYGROUND became true in P7.)
export const SHOW_PG_BADGE = false; // P8: PostgreSQL conformance
export const SHOW_PLAYGROUND = true; // P7: /playground, share links, "Re-run in your browser"
export const SHOW_CONFORMANCE_SECTION = false; // P8: About page conformance report

export const SITE_NAME = "Anomaly Zoo";
export const TAGLINE = "Watch database isolation bugs happen. Then turn them off.";
