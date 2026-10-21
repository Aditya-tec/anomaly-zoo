// Share links: #s=<base64url(UTF-8 source)> (spec §7.6, §10.4). Everything in
// here treats its input as hostile: the fragment is length-checked before it
// is decoded, decoding is strict (no padding, no whitespace, no other
// alphabet), invalid UTF-8 and control characters are rejected, and the result
// is size-limited again. It never throws.
import { checkSourceLimits, MAX_LINK_PAYLOAD } from "./limits";

export type ShareResult = { ok: true; source: string } | { ok: false; reason: string };
export type EncodeResult = { ok: true; payload: string } | { ok: false; reason: string };

const B64URL = /^[A-Za-z0-9_-]*$/;

function toBase64Url(binary: string): string {
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function encodeShare(source: string): EncodeResult {
  const bytes = new TextEncoder().encode(source);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const payload = toBase64Url(bin);
  if (payload.length > MAX_LINK_PAYLOAD) {
    return { ok: false, reason: `This scenario is too large to share as a link (the link would be ${payload.length} characters; the limit is ${MAX_LINK_PAYLOAD}).` };
  }
  return { ok: true, payload };
}

/** Decodes the part after `#s=`. */
export function decodeShare(payload: string): ShareResult {
  if (payload.length === 0) return { ok: false, reason: "the link contains no scenario" };
  if (payload.length > MAX_LINK_PAYLOAD) return { ok: false, reason: `the link is longer than ${MAX_LINK_PAYLOAD} characters` };
  if (!B64URL.test(payload)) return { ok: false, reason: "the link is not valid base64url" };
  if (payload.length % 4 === 1) return { ok: false, reason: "the link is not valid base64url (impossible length)" };

  let bin: string;
  try {
    const std = payload.replace(/-/g, "+").replace(/_/g, "/");
    bin = atob(std + "=".repeat((4 - (std.length % 4)) % 4));
  } catch {
    return { ok: false, reason: "the link is not valid base64url" };
  }
  // Canonical form only: atob tolerates non-zero padding bits, which would give one source many spellings.
  if (toBase64Url(bin) !== payload) return { ok: false, reason: "the link is not canonical base64url" };
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: "the link does not contain valid UTF-8 text" };
  }
  const problem = checkSourceLimits(text);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, source: text };
}

export type HashResult = { kind: "none" } | { kind: "error"; message: string } | { kind: "source"; source: string };

/**
 * Reads location.hash. Only the exact shape `#s=<payload>` is a share link;
 * any other hash (for example an in-page anchor) is "none". A malformed share
 * link is an error, never a partially trusted value.
 */
export function readShareHash(hash: string): HashResult {
  if (!hash.startsWith("#s=")) return { kind: "none" };
  const r = decodeShare(hash.slice(3));
  return r.ok ? { kind: "source", source: r.source } : { kind: "error", message: `This link could not be used: ${r.reason}. Nothing was run.` };
}
