import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: [
      'lucide-react',
      'ssh2',
      'node-ssh',
      'simple-ssh',
      'cpu-features',
    ],
  },
  build: {
    rollupOptions: {
      external: ['ssh2', 'node-ssh', 'simple-ssh', 'cpu-features'],
    },
  },
});
