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
      name: "docs-next-css-import-order",
      enforce: "pre",
      transform(source, id) {
        if (!id.replaceAll("\\", "/").endsWith("/app/globals.css")) return;
        // Vite's CSS importer runs before Tailwind; Next accepts these directives
        // between imports. Preserve every real stylesheet/rule, reorder imports only.
        const imports = source.match(/^@import .+;$/gm) ?? [];
        return (
          imports.join("\n") + "\n" + source.replace(/^@import .+;$/gm, "")
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
      "use-sync-external-store/shim",
      "use-sync-external-store/shim/with-selector",
      "jsqr",
      "qrcode",
      "gifenc",
      "ipaddr.js",
      "lucide-react",
    ],
  },
  // Scan UI sources only, never native target/build trees in this large repo.
  css: {
    postcss: {
      plugins: [tailwindcss({ base: local("../../src/") }), autoprefixer()],
    },
  },
  resolve: {
    alias: [
      { find: "@tauri-apps/api/core", replacement: local("./native.ts") },
      { find: "@tauri-apps/api/event", replacement: local("./events.ts") },
      { find: /^@\//, replacement: local("../../src/") },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 4319,
    strictPort: true,
    watch: null,
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:4319; frame-src 'none'; object-src 'none'; form-action 'none'",
    },
    fs: { allow: [local("../../")] },
  },
});
