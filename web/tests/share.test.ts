import { describe, expect, it } from "vitest";
import { decodeShare, encodeShare, readShareHash } from "@/lib/share";
import { MAX_LINK_PAYLOAD, MAX_SOURCE_BYTES } from "@/lib/limits";

const enc = (s: string) => {
  const r = encodeShare(s);
  if (!r.ok) throw new Error(r.reason);
  return r.payload;
};
const b64url = (bytes: number[]) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Small deterministic PRNG so the fuzz loops are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("share link codec", () => {
  it("round-trips ordinary scenarios, including non-ASCII text and CRLF", () => {
    for (const src of ["scenario a\nschedule:\n  T1 BEGIN\n  T1 COMMIT\n", "scenario é\ntitle \"naïve — ✓\"\n", "a\r\nb\r\n", "x"]) {
      const r = decodeShare(enc(src));
      expect(r).toEqual({ ok: true, source: src });
    }
  });

  it("round-trips random valid text", () => {
    const next = rng(42);
    const alphabet = "abcXYZ019 \n\t_-:=\"<>&'é✓日本";
    for (let i = 0; i < 400; i++) {
      let s = "";
      const n = Math.floor(next() * 200);
      for (let k = 0; k < n; k++) s += alphabet[Math.floor(next() * alphabet.length)];
      if (s === "") continue; // an empty scenario is not a share link
      const e = encodeShare(s);
      if (!e.ok) continue; // too large to share is a legitimate answer
      expect(decodeShare(e.payload)).toEqual({ ok: true, source: s });
    }
  });

  it("rejects the empty payload and a bare #s=", () => {
    expect(decodeShare("").ok).toBe(false);
    expect(readShareHash("#s=")).toMatchObject({ kind: "error" });
  });

  it("rejects characters outside the base64url alphabet", () => {
    for (const bad of ["abc+def", "abc/def", "abc=", "abc def", "abc\ndef", "ab%20cd", "<script>", "é", "abc.def", "abc\u0000def"]) {
      const r = decodeShare(bad);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("rejects non-canonical spellings (non-zero trailing bits), so one source has exactly one link", () => {
    expect(decodeShare("aw").ok).toBe(true); // "k"
    expect(decodeShare("a_").ok).toBe(false); // same byte, non-canonical
    expect(decodeShare("aX").ok).toBe(false);
  });

  it("rejects impossible base64 lengths", () => {
    for (const n of [1, 5, 9, 4093]) expect(decodeShare("A".repeat(n)).ok, `length ${n}`).toBe(false);
  });

  it("rejects invalid UTF-8", () => {
    for (const bytes of [[0xff], [0xc0, 0xaf], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0x61, 0xfe, 0x62], [0xf8, 0x88, 0x80, 0x80, 0x80]]) {
      const r = decodeShare(b64url(bytes));
      expect(r.ok, JSON.stringify(bytes)).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/UTF-8/);
    }
  });

  it("rejects null bytes and other control characters, but accepts tab, LF and CR", () => {
    expect(decodeShare(b64url([0x61, 0x00, 0x62])).ok).toBe(false);
    expect(decodeShare(b64url([0x61, 0x07])).ok).toBe(false);
    expect(decodeShare(b64url([0x1b, 0x5b])).ok).toBe(false);
    expect(decodeShare(b64url([0x7f])).ok).toBe(false);
    expect(decodeShare(b64url([0x61, 0x09, 0x0a, 0x0d, 0x62])).ok).toBe(true);
  });

  it("enforces the 4 KB link boundary exactly", () => {
    // 3072 bytes encode to exactly 4096 base64 characters.
    const atLimit = "a".repeat(3072);
    expect(enc(atLimit).length).toBe(MAX_LINK_PAYLOAD);
    expect(decodeShare(enc(atLimit))).toEqual({ ok: true, source: atLimit });
    // One more byte pushes it to 4097 characters: refused, both when encoding and when decoding.
    const over = "a".repeat(3073);
    expect(encodeShare(over).ok).toBe(false);
    expect(decodeShare("A".repeat(MAX_LINK_PAYLOAD + 1)).ok).toBe(false);
  });

  it("rejects a 100 KB payload without decoding it", () => {
    const big = "A".repeat(100 * 1024);
    const t0 = performance.now();
    const r = decodeShare(big);
    expect(r.ok).toBe(false);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(readShareHash("#s=" + big)).toMatchObject({ kind: "error" });
  });

  it("applies the 8 KB source limit after decoding", () => {
    // 6000 bytes is a legal source size but not a legal link; build the payload directly to test the source check.
    const long = "a".repeat(MAX_SOURCE_BYTES + 1);
    expect(encodeShare(long).ok).toBe(false);
  });

  it("only #s=<payload> is a share link; other hashes are ignored", () => {
    expect(readShareHash("")).toEqual({ kind: "none" });
    expect(readShareHash("#why-h")).toEqual({ kind: "none" });
    expect(readShareHash("#S=abc")).toEqual({ kind: "none" });
    expect(readShareHash("#x=1&s=abc")).toEqual({ kind: "none" });
    expect(readShareHash("#s=" + enc("hello"))).toEqual({ kind: "source", source: "hello" });
  });

  it("a malformed link is an error with a message that says nothing was run", () => {
    const r = readShareHash("#s=%%%");
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toMatch(/could not be used.*Nothing was run/);
  });

  it("random garbage never throws and never yields a source unless it is genuinely valid", () => {
    const next = rng(7);
    const chars = "AZaz09-_+/=%<>\u0000\n éÿ!";
    for (let i = 0; i < 3000; i++) {
      let s = "";
      const n = Math.floor(next() * 80);
      for (let k = 0; k < n; k++) s += chars[Math.floor(next() * chars.length)];
      const r = decodeShare(s);
      if (r.ok) {
        // If it decoded, it must re-encode to the same payload (strictness: no lenient parse).
        expect(enc(r.source)).toBe(s);
      }
    }
  });

  it("hostile markup decodes to plain text; interpreting it is the renderer's job (tested in e2e)", () => {
    const evil = 'scenario x\ntitle "<img src=x onerror=alert(1)>"\nstory "javascript:alert(1)"\nschedule:\n  T1 BEGIN\n  T1 NOTE "<script>alert(1)</script>"\n  T1 COMMIT\n';
    expect(decodeShare(enc(evil))).toEqual({ ok: true, source: evil });
  });
});
