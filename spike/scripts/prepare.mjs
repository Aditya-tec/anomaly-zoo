// Copies the engine artifacts into public/engine and writes app/golden.json
// (the write-skew@SER source and the digest of its committed golden trace).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const spike = resolve(here, "..");
const repo = resolve(spike, "..");

function need(p) {
  if (!existsSync(p)) {
    throw new Error(
      `missing ${p}. The spike build reads files from the repository root, so the Vercel project must ` +
        `include source files outside the Root Directory (see docs/P0-CHECKLIST.md).`
    );
  }
  return p;
}

const engineSrc = need(join(repo, "web", "public", "engine"));
const meta = JSON.parse(readFileSync(join(engineSrc, "engine.json"), "utf8"));
const wasm = readFileSync(need(join(engineSrc, meta.wasm)));
if (createHash("sha256").update(wasm).digest("hex") !== meta.wasmSha256) {
  throw new Error(`${meta.wasm} does not match wasmSha256 in engine.json`);
}

const dst = join(spike, "public", "engine");
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
for (const f of ["engine.json", meta.wasm, meta.wasmExec, "worker.js", "client.mjs"]) {
  cpSync(need(join(engineSrc, f)), join(dst, f));
}

const level = "SER";
const goldenTrace = JSON.parse(readFileSync(need(join(repo, "engine", "testdata", "golden", `write-skew.${level}.json`)), "utf8"));
const manifest = JSON.parse(readFileSync(need(join(repo, "web", "public", "traces", "manifest.json")), "utf8"));
const fromManifest = manifest.scenarios.find((s) => s.id === "write-skew").traces[level].digest;
if (goldenTrace.digest !== fromManifest) {
  throw new Error(`golden digest ${goldenTrace.digest} differs from manifest digest ${fromManifest}`);
}
writeFileSync(
  join(spike, "app", "golden.json"),
  JSON.stringify({
    scenario: "write-skew",
    level,
    digest: goldenTrace.digest,
    source: readFileSync(need(join(repo, "scenarios", "write-skew.azs")), "utf8").replace(/\r\n/g, "\n"),
  }) + "\n"
);
console.log(`prepare: engine ${meta.wasm}, golden digest ${goldenTrace.digest.slice(0, 12)}...`);