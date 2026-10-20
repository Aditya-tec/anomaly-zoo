// npm run build: prepare -> next build (static export to out/) -> inject CSP -> verify CSP.
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const spike = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };

function step(label, args) {
  console.log(`\n> ${label}`);
  const r = spawnSync(process.execPath, args, { cwd: spike, env, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`${label} failed (exit ${r.status})`);
    process.exit(r.status || 1);
  }
}

step("prepare engine files", [join("scripts", "prepare.mjs")]);
step("next build", [join("node_modules", "next", "dist", "bin", "next"), "build"]);
step("inject CSP", [join("scripts", "inject-csp.mjs")]);
step("verify CSP", [join("scripts", "verify-csp.mjs")]);