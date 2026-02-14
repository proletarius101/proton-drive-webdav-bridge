import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config
// ESM configuration for Electron main process
export default defineConfig({
  build: {
    lib: {
      entry: 'src-electron/main.ts',
      formats: ['es'],
      fileName: () => 'main.mjs',
    },
    rollupOptions: {
      external: ['electron', 'better-sqlite3', '@napi-rs/keyring'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
