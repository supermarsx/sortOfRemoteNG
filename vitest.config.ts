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
    ],
    deps: {
      inline: [
        '@tauri-apps/plugin-fs',
        '@tauri-apps/plugin-dialog',
        '@tauri-apps/api'
      ]
    },
    alias: {
      '@tauri-apps/plugin-fs': new URL('./vitest.mocks/tauri-plugin-fs.ts', import.meta.url).pathname,
      '@tauri-apps/plugin-dialog': new URL('./vitest.mocks/tauri-plugin-dialog.ts', import.meta.url).pathname
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
      all: true,
    }
  }
});
