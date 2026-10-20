import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
export default {
  output: "export", // static files only; no server (spec §3.4)
  images: { unoptimized: true },
  poweredByHeader: false,
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
};
