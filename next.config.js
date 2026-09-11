import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tauriManagedDev = process.env.SORNG_TAURI_MANAGED_DEV === "1";
const development = process.env.NODE_ENV === "development";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Browser and Tauri development may intentionally run together on different
  // ports. Their lock/cache roots remain separate, while duplicate managed
  // launches are rejected explicitly by the launchers before Next starts.
  distDir: tauriManagedDev ? ".next-tauri-dev" : ".next",
  output: "export",
  // Packaged pages receive the parent policy from Tauri. Static export cannot
  // serve headers; keep this matching development-only rule on Next's server.
  // This blocks remote frame destinations, not all network APIs or WebRTC.
  ...(development && {
    headers: async () => [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-src http://*.localhost:*",
          },
        ],
      },
    ],
  }),
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
