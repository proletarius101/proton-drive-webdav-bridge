import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  root: path.resolve(__dirname, 'src/gui'),
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: process.env.TAURI_DEV_HOST || 'localhost',
    hmr: {
      host: process.env.TAURI_DEV_HOST || 'localhost',
    },
    watch: {
      ignored: ['**/src-tauri/**']
    }
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/gui'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2020'
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
})
