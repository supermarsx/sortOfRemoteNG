import base from "../docs-demo/vite.config.mjs";
import { fileURLToPath } from "node:url";
const local = (file) => fileURLToPath(new URL(file, import.meta.url));
export default {
  ...base,
  root: local("./"),
  optimizeDeps: {
    ...base.optimizeDeps,
    include: [...base.optimizeDeps.include, "react-dom/server"],
  },
  resolve: {
    alias: [
      ...[
        "@tauri-apps/api/core",
        "@tauri-apps/api/event",
        "@tauri-apps/plugin-dialog",
        "@tauri-apps/plugin-fs",
      ].map((find) => ({ find, replacement: local("./native.ts") })),
      { find: /^@\//, replacement: local("../../src/") },
    ],
  },
  server: {
    ...base.server,
    port: 4323,
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:4323; frame-src 'none'; object-src 'none'; form-action 'none'",
    },
  },
};
