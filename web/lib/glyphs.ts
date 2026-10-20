// Each transaction gets a colour AND a glyph, never colour alone (spec §7.5).
export const TXN_GLYPHS = ["●", "■", "▲", "◆", "★", "⬟"] as const;

export function txnNumber(id: string): number {
  const n = Number.parseInt(id.slice(1), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function txnGlyph(id: string): string {
  return TXN_GLYPHS[(txnNumber(id) - 1) % TXN_GLYPHS.length] ?? "●";
}

/** CSS custom property holding the transaction's colour. */
export function txnColorVar(id: string): string {
  return `var(--txn-${((txnNumber(id) - 1) % 6) + 1})`;
}
