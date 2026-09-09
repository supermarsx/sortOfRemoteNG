import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/postcss";
import autoprefixer from "autoprefixer";
const local = (file) => fileURLToPath(new URL(file, import.meta.url));
export default defineConfig({
  root: local("./"),
  plugins: [
    react(),
    {
      name: "trust-fixture-next-css-order",
      enforce: "pre",
      transform(source, id) {
        if (!id.replaceAll("\\", "/").endsWith("/app/globals.css")) return;
        return (
          (source.match(/^@import .+;$/gm) ?? []).join("\n") +
          "\n" +
          source.replace(/^@import .+;$/gm, "")
        );
      },
    },
  ],
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
  css: {
    postcss: {
      plugins: [tailwindcss({ base: local("../../src/") }), autoprefixer()],
    },
  },
  resolve: {
    alias: [
      { find: "@tauri-apps/api/core", replacement: local("./boundary.ts") },
      {
        find: "../connection/databaseManager",
        replacement: local("./boundary.ts"),
      },
      { find: /^@\//, replacement: local("../../src/") },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 4320,
    strictPort: true,
    watch: null,
    fs: { allow: [local("../../")] },
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:4320; frame-src 'none'; object-src 'none'; form-action 'none'",
    },
  },
});
