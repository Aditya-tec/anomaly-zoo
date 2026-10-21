// The static limits of spec §4.10, checked in the browser BEFORE anything is
// sent to the worker. These are cheap, conservative pre-checks on the raw text;
// the engine's parser (the authority) re-validates everything it receives.
export const MAX_SOURCE_BYTES = 8 * 1024;
export const MAX_STEPS = 200;
export const MAX_TXNS = 6;
export const MAX_KEYS = 64;
/** Longest accepted `#s=` payload (spec §7.6: refuse links over 4 KB). */
export const MAX_LINK_PAYLOAD = 4096;

export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Returns a message for the first limit the source breaks, or null. */
export function checkSourceLimits(source: string): string | null {
  const bytes = utf8Length(source);
  if (bytes > MAX_SOURCE_BYTES) return `The scenario is ${bytes.toLocaleString("en-US")} bytes; the limit is ${MAX_SOURCE_BYTES.toLocaleString("en-US")}.`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(source)) return "The scenario contains control characters, which are not allowed.";

  let steps = 0;
  const txns = new Set<string>();
  const keys = new Set<string>();
  for (const line of source.split(/\r\n|\r|\n/)) {
    const m = /^\s+(T\d+)\s+(\w+)(?:\s+(\S+))?/.exec(line);
    if (!m) {
      const setup = /^\s+PUT\s+(\S+)\s*=/.exec(line); // setup block line
      if (setup?.[1]) keys.add(setup[1]);
      continue;
    }
    steps++;
    txns.add(m[1] ?? "");
    if (m[3] && (m[2] === "READ" || m[2] === "PUT" || m[2] === "DELETE")) keys.add(m[3]);
  }
  if (steps > MAX_STEPS) return `The schedule has ${steps} steps; the limit is ${MAX_STEPS}.`;
  if (txns.size > MAX_TXNS) return `The schedule uses ${txns.size} transactions; the limit is ${MAX_TXNS}.`;
  if (keys.size > MAX_KEYS) return `The scenario uses ${keys.size} distinct keys; the limit is ${MAX_KEYS}.`;
  return null;
}
