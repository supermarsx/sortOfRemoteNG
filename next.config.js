import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tauriManagedDev = process.env.SORNG_TAURI_MANAGED_DEV === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Browser and Tauri development may intentionally run together on different
  // ports. Their lock/cache roots remain separate, while duplicate managed
  // launches are rejected explicitly by the launchers before Next starts.
  distDir: tauriManagedDev ? ".next-tauri-dev" : ".next",
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  turbopack: {
    // Pin the Turbopack workspace root to this package so Next.js 16 does
    // not walk up through nested git worktrees / lockfiles when inferring
    // the root. Silences the "multiple lockfiles" warning in CI.
    root: __dirname,
  },
};

export default nextConfig;
