// Claims policy check (spec 13.3), run in CI:
//   node scripts/check-claims.mjs
// 1. Banned phrases must not appear in the README, the About page text, the COPY files,
//    the launch drafts or the release checklist.
// 2. Every number in those files must come from a recorded source: conformance.json (including
//    percentages computed from its counts), docs/PROGRESS.md and docs/DECISIONS.md (the logs of recorded runs), or the
//    short list of structural numbers in docs/claims-allowlist.txt (each with a reason).
// 3. In the README and in launch drafts, a paragraph that contains such a number must also
//    cite where it comes from: a markdown link (README) or a [source: ...] / [MISSING: ...] marker (drafts).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(here, "..");

/** Banned phrases (spec 13.3). Superlative claims are matched by shape, not by bare words,
 * because "standard library only" and "first-updater-wins" are legitimate. */
export const BANNED = [
  [/\bthe (first|only|best)\b/i, 'superlative ("the first / the only / the best")'],
  [/\b(first|only|best)\s+(interactive|isolation|database|explainer|visuali[sz]er|tool|demo)\b/i, "superlative claim about the project"],
  [/match(es)? postgres(ql)? exactly/i, '"matches PostgreSQL exactly"'],
  [/production[- ]ready/i, '"production-ready"'],
  [/\ba real database\b/i, '"a real database"'],
  [/fully implements (ssi|serializable)/i, '"fully implements SSI"'],
  [/\bproves?\b[^.\n]{0,40}\bserializ/i, '"proves Serializable is correct"'],
  [/\b(mysql|mariadb|sql server|oracle (db|database)|oracle's)\b/i, "a claim about MySQL, Oracle or SQL Server"],
];

/** Everything that can legitimately contain a number: strip it before looking for figures. */
export function stripNonClaims(text) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/\[(source|MISSING)[^\]]*\]/gi, " ")
    .replace(/\]\([^)]*\)/g, "] ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<[^>\n]+>/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\bv?\d+\.\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?\b/g, " ") // versions
    .replace(/\b[0-9a-f]{7,64}\b/gi, " ") // hashes, seeds written in hex
    .replace(/^\s{0,3}#{1,6}\s+\d+\.?\s/gm, " ") // numbered headings
    .replace(/^\s*\d+[.)]\s/gm, " ") // ordered list markers
    .replace(/\bP\d+\b|\bAC\d+\.\d+\b|\bD-P\d+-\d+\b|§\s?\d+(\.\d+)*/g, " "); // phase, criterion, decision ids, spec sections
}

/** Numeric tokens: 1,234 / 95.6% / 0.6 / 20000. Returned normalised (no commas, no percent sign). */
export function numbersIn(text) {
  const out = [];
  for (const m of stripNonClaims(text).matchAll(/(?<![\w.])\d[\d,]*(?:\.\d+)?/g)) {
    out.push(m[0].replace(/,/g, "").replace(/\.$/, "").replace(/^0+(?=\d)/, "")); // "No. 01" is the number 1
  }
  return out;
}

function leaves(v, acc = []) {
  if (typeof v === "number") acc.push(v);
  else if (typeof v === "string") for (const m of v.matchAll(/\d+(?:\.\d+)?/g)) acc.push(Number(m[0]));
  else if (Array.isArray(v)) v.forEach((x) => leaves(x, acc));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => leaves(x, acc));
  return acc;
}

/** Numbers that conformance.json records or that its counts give (percentages, same pairs as the site). */
export function confNumbers(root = ROOT) {
  const set = new Set();
  const add = (n) => {
    const s = String(n);
    set.add(s);
    if (Number.isFinite(Number(s))) set.add(String(Number(s)));
  };
  const confPath = join(root, "web", "public", "conformance.json");
  if (existsSync(confPath)) {
    const conf = JSON.parse(readFileSync(confPath, "utf8"));
    leaves(conf).forEach(add);
    // Percentages the site and the README compute from counts (same pairs, 1 and 2 decimals).
    const pct = (n, d) => {
      if (!d) return;
      for (const digits of [0, 1, 2]) add(((100 * n) / d).toFixed(digits));
    };
    const groups = [...Object.values(conf.random ?? {})];
    for (const g of groups) {
      const nums = Object.entries(g).filter(([, v]) => typeof v === "number");
      for (const [, a] of nums) for (const [, b] of nums) if (b > 0 && a <= b) pct(a, b);
    }
    const cells = (conf.canned ?? []).flatMap((c) => Object.values(c.levels ?? {}));
    add(cells.length);
    add(cells.filter((c) => c.classMatch).length);
    add(cells.filter((c) => c.identical).length);
    add(conf.canned?.length ?? 0);
  }
  return set;
}

/** The numbers in the recorded logs (docs/PROGRESS.md, docs/DECISIONS.md). */
export function logNumbers(root = ROOT) {
  const set = new Set();
  for (const log of ["PROGRESS.md", "DECISIONS.md"]) {
    const p = join(root, "docs", log);
    if (existsSync(p)) for (const n of numbersIn(readFileSync(p, "utf8"))) set.add(n);
  }
  return set;
}

/** The recorded-source number set: conformance.json, the logs, and the structural allowlist. */
export function recordedNumbers(root = ROOT) {
  const set = new Set([...confNumbers(root), ...logNumbers(root)]);
  const add = (n) => set.add(String(n));
  const alw = join(root, "docs", "claims-allowlist.txt");
  if (existsSync(alw)) {
    for (const line of readFileSync(alw, "utf8").split("\n")) {
      const t = line.replace(/#.*/, "").trim();
      if (t) add(t.split(/\s+/)[0]);
    }
  }
  return set;
}

/** Numbers listed in docs/claims-allowlist.txt: structural, so they need no citation of their own. */
export function structuralNumbers(root = ROOT) {
  const set = new Set();
  const alw = join(root, "docs", "claims-allowlist.txt");
  if (existsSync(alw)) {
    for (const line of readFileSync(alw, "utf8").split("\n")) {
      const t = line.replace(/#.*/, "").trim();
      if (t) set.add(t.split(/\s+/)[0]);
    }
  }
  return set;
}

export const SUBSET_LABEL_TEXT = "subset chosen after the fact to explain the differences, not an independent result";
const SUBSET_LABEL = /subset chosen after the fact to explain the differences, not an independent result/i;
const SUBSET_TRIGGER = /no two statements (?:were |are )?blocked at (?:once|the same time)|blocked at once/i;

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const NUM = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
const toNum = (s) => (/^\d+$/.test(s) ? Number(s) : WORDS[s.toLowerCase()]);

/**
 * The number of documented divergences, and how many have "cause not yet established", change as
 * conformance.json changes. Wherever a document states either count it must match the file.
 * div = { total, unestablished } read from web/public/conformance.json.
 */
export function staleDivergenceCounts(name, text, div) {
  const problems = [];
  // "8 documented differences", "five divergences", "there are 8, each with a minimal schedule"
  const total = new RegExp(`\\b${NUM}\\s+(?:documented\\s+)?(?:differences|divergences)\\b|\\bthere are ${NUM},?\\s+each with a minimal schedule`, "gi");
  for (const m of text.matchAll(total)) {
    const n = toNum(m[1] ?? m[2]);
    if (n !== div.total) problems.push(`${name}: says ${m[0].trim()}, but conformance.json has ${div.total} divergences`);
  }
  // "two ... \"cause not yet established\"": the nearest count before the phrase
  for (const m of text.matchAll(/cause not yet established/gi)) {
    const before = text.slice(Math.max(0, m.index - 70), m.index);
    const found = [...before.matchAll(new RegExp(`\\b${NUM}\\b`, "gi"))];
    const last = found[found.length - 1];
    if (last && toNum(last[1]) !== div.unestablished && /\b(?:of them|are|is|with|marked|listed|recorded)\b/i.test(before.slice(last.index))) {
      problems.push(`${name}: says ${last[1]} with "cause not yet established", but conformance.json has ${div.unestablished}`);
    }
  }
  return problems;
}

/** Divergence totals from the committed report. */
export function divergenceCounts(root = ROOT) {
  const p = join(root, "web", "public", "conformance.json");
  if (!existsSync(p)) return null;
  const ds = JSON.parse(readFileSync(p, "utf8")).knownDivergences ?? [];
  return { total: ds.length, unestablished: ds.filter((d) => !d.causeEstablished).length };
}

const paragraphs = (text) => text.split(/\n\s*\n/);

/** Returns a list of problems for one file. kind: "readme" | "draft" | "page" | "copy". */
export function checkText(name, text, kind, recorded, structural = new Set(), perSource = null) {
  const problems = [];
  if (perSource && perSource.div) problems.push(...staleDivergenceCounts(name, text, perSource.div));
  for (const [re, what] of BANNED) {
    // The bare "the first / the only / the best" pattern is for text written as a claim; the COPY
    // files merely list wording ("the first two words"), where only the shaped patterns apply.
    if (kind === "copy" && re === BANNED[0][0]) continue;
    const m = text.match(re);
    if (m) problems.push(`${name}: banned phrase ${what}: "${m[0]}"`);
  }
  // The "no two statements blocked at once" subset was chosen after the fact to explain the
  // differences. Wherever it is shown it must say so (the README, the About page and every launch draft).
  if (kind !== "copy") {
    if (SUBSET_TRIGGER.test(text) && !SUBSET_LABEL.test(text)) {
      problems.push(`${name}: shows the "no two statements blocked at once" subset without the label "${SUBSET_LABEL_TEXT}"`);
    }
    if (kind !== "page") {
      for (const para of paragraphs(text)) {
        if (SUBSET_TRIGGER.test(para) && !SUBSET_LABEL.test(para)) problems.push(`${name}: a paragraph shows the "no two statements blocked at once" subset without the label "${SUBSET_LABEL_TEXT}": "${para.trim().slice(0, 70).replace(/\s+/g, " ")}..."`);
      }
    }
  }
  for (const para of paragraphs(text)) {
    const bad = numbersIn(para).filter((n) => !recorded.has(n));
    for (const n of new Set(bad)) problems.push(`${name}: number ${n} is not in any recorded source (conformance.json, docs/PROGRESS.md, docs/claims-allowlist.txt): "${para.trim().slice(0, 80).replace(/\s+/g, " ")}..."`);
    if (perSource) {
      // A number written just before a citation must come from the cited source, not from anywhere.
      const marker = /\[source:[^\]]*\]|\]\([^)]*\)/g;
      let last = 0;
      for (const m of para.matchAll(marker)) {
        const chunk = para.slice(last, m.index);
        last = m.index + m[0].length;
        const cited = m[0];
        const allowed = /conformance\.json/.test(cited) ? perSource.conf : /PROGRESS|DECISIONS/.test(cited) ? perSource.logs : null;
        if (!allowed) continue;
        for (const n of new Set(numbersIn(chunk))) {
          if (ALWAYS_OK.has(n) || structural.has(n) || allowed.has(n)) continue;
          problems.push(`${name}: number ${n} is cited to ${/conformance\.json/.test(cited) ? "conformance.json" : "the logs"} but is not in it: "${chunk.trim().slice(-80).replace(/\s+/g, " ")}"`);
        }
      }
    }
    const hasFigure = numbersIn(para).some((n) => !ALWAYS_OK.has(n) && !structural.has(n));
    if (hasFigure && kind === "draft" && !/\[(source|MISSING):/i.test(para)) {
      problems.push(`${name}: a paragraph with figures has no [source: ...] or [MISSING: ...] marker: "${para.trim().slice(0, 80).replace(/\s+/g, " ")}..."`);
    }
    if (hasFigure && kind === "readme" && !/(\]\([^)]+\)|href="[^"]+")/.test(para)) {
      problems.push(`${name}: a README paragraph with figures has no link to its source: "${para.trim().slice(0, 80).replace(/\s+/g, " ")}..."`);
    }
  }
  return problems;
}

// Small counting numbers that read as words ("two sentences") need no citation of their own.
const ALWAYS_OK = new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);

export const FILES = () => {
  const files = [
    ["README.md", "readme"],
    ["web/app/about/page.tsx", "page"],
    ["web/components/ConformanceSection.tsx", "page"],
    ["docs/COPY-TODO.md", "copy"],
    ["docs/RELEASE-CHECKLIST.md", "copy"],
  ];
  const launch = join(ROOT, "docs", "launch");
  if (existsSync(launch)) for (const f of readdirSync(launch)) if (f.endsWith(".md")) files.push([`docs/launch/${f}`, f === "README.md" ? "copy" : "draft"]);
  return files;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const recorded = recordedNumbers();
  const structural = structuralNumbers();
  const perSource = { conf: confNumbers(), logs: logNumbers(), div: divergenceCounts() };
  const all = [];
  let checked = 0;
  for (const [f, kind] of FILES()) {
    const p = join(ROOT, f);
    if (!existsSync(p)) continue;
    checked++;
    all.push(...checkText(f, readFileSync(p, "utf8").replace(/\r\n/g, "\n"), kind, recorded, structural, perSource));
  }
  if (all.length) {
    console.error(`claims check FAILED (${all.length}):\n  ${all.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`claims check: OK, ${checked} file(s), ${recorded.size} recorded numbers, no banned phrase`);
}
