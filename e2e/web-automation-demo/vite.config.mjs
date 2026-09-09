import base from "../docs-demo/vite.config.mjs";
import { fileURLToPath } from "node:url";
const local = (file) => fileURLToPath(new URL(file, import.meta.url));
export default {
  ...base,
  root: local("./"),
  optimizeDeps: {
    noDiscovery: true,
    include: [
      "react",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "lucide-react",
    ],
  },
  resolve: {
    alias: [
      { find: "@tauri-apps/api/core", replacement: local("./native.ts") },
      { find: "@tauri-apps/api/event", replacement: local("./native.ts") },
      { find: /^@\//, replacement: local("../../src/") },
    ],
  },
  server: {
    ...base.server,
    port: 4325,
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:4325; frame-src 'none'; object-src 'none'; form-action 'none'",
    },
  },
};
