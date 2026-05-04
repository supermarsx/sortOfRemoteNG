import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './vitest.setup.ts',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.claude/**',
      '**/e2e/**',
    ],
    server: {
      deps: {
        inline: [
          '@tauri-apps/plugin-fs',
          '@tauri-apps/plugin-dialog',
          '@tauri-apps/api'
        ]
      }
    },
    alias: {
      '@tauri-apps/plugin-fs': new URL('./vitest.mocks/tauri-plugin-fs.ts', import.meta.url).pathname,
      '@tauri-apps/plugin-dialog': new URL('./vitest.mocks/tauri-plugin-dialog.ts', import.meta.url).pathname,
      // Mirror tsconfig.json `paths` so modules that use the `@/*` alias
      // (e.g. src/components/connection/CheckConnectionsModal.tsx) resolve
      // under vitest the same way they do under Next.js / the Tauri webview.
      '@/': new URL('./src/', import.meta.url).pathname,
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/index.ts',
        'src/types/**',
        'src/vite-env.d.ts',
        'src/main.tsx',
      ],
      // RATCHET (t3-e34): floor set at current ~34.7% line coverage minus a
      // 5pt buffer so e40 (bcryptjs→Rust) and e41 (ssh-client retirement)
      // landing can't accidentally red-gate CI. Before 1.0 RC, raise to
      // `lines: 60, statements: 60, functions: 60, branches: 50` per
      // `.orchestration/plans/t3.md` §t3-e34 acceptance target.
      thresholds: {
        lines: 30,
        statements: 30,
        functions: 30,
        branches: 25,
      },
    }
  }
});
