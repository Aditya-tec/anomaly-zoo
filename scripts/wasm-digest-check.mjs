// Native-vs-WASM digest equality (spec P8/AC5.2). Loads the committed engine
// WASM under Node, runs every scenario at every level and compares the trace
// digest with the one the native `azoo traces` wrote to manifest.json.
// Exits non-zero on any difference.
//
//   node scripts/wasm-digest-check.mjs [--engine web/public/engine]
//        [--manifest web/public/traces/manifest.json] [--scenarios scenarios]

import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

export async function loadEngine(engineDir) {
  const dir = resolve(engineDir);
  const meta = JSON.parse(readFileSync(join(dir, "engine.json"), "utf8"));
  const execJs = readFileSync(join(dir, meta.wasmExec));
  const wasm = readFileSync(join(dir, meta.wasm));
  if (createHash("sha256").update(wasm).digest("hex") !== meta.wasmSha256) {
    throw new Error(`${meta.wasm} does not match wasmSha256 in engine.json`);
  }
  if (createHash("sha256").update(execJs).digest("hex") !== meta.wasmExecSha256) {
    throw new Error(`${meta.wasmExec} does not match wasmExecSha256 in engine.json`);
  }
  await import(pathToFileURL(join(dir, meta.wasmExec)).href);
  const go = new globalThis.Go();
  const { instance } = await WebAssembly.instantiate(wasm, go.importObject);
  go.run(instance); // blocks forever inside Go; the exported functions stay callable
  return { azoo: globalThis.azoo, meta };
}

export async function checkDigests({ engineDir, manifestPath, scenariosDir }) {
  const { azoo, meta } = await loadEngine(engineDir);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.engineVersion !== meta.engineVersion || azoo.version() !== meta.engineVersion) {
    throw new Error(`engine version mismatch: manifest ${manifest.engineVersion}, engine.json ${meta.engineVersion}, wasm ${azoo.version()}`);
  }
  const files = readdirSync(scenariosDir).filter((f) => f.endsWith(".azs")).sort();
  let compared = 0;
  const failures = [];
  for (const f of files) {
    const src = readFileSync(join(scenariosDir, f), "utf8");
    const id = f.replace(/\.azs$/, "");
    const entry = manifest.scenarios.find((s) => s.id === id);
    if (!entry) { failures.push(`${id}: not in manifest`); continue; }
    for (const level of manifest.levels) {
      const res = azoo.run(src, level);
      const want = entry.traces[level].digest;
      if (!res.ok) { failures.push(`${id}@${level}: WASM returned errors ${JSON.stringify(res.errors)}`); continue; }
      compared++;
      if (res.trace.digest !== want) failures.push(`${id}@${level}: WASM digest ${res.trace.digest} != native ${want}`);
    }
  }
  const expected = manifest.scenarios.length * manifest.levels.length;
  if (compared !== expected) failures.push(`compared ${compared} traces, manifest lists ${expected}`);
  return { compared, failures };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
  const { compared, failures } = await checkDigests({
    engineDir: opt("--engine", "web/public/engine"),
    manifestPath: opt("--manifest", "web/public/traces/manifest.json"),
    scenariosDir: opt("--scenarios", "scenarios"),
  });
  if (failures.length) {
    console.error("DIGEST MISMATCH:\n  " + failures.join("\n  "));
    process.exit(1);
  }
  console.log(`DIGESTS EQUAL: ${compared}/${compared} native and WASM trace digests are identical`);
}
