import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds the app into ../public/app, which server.js serves at /app.
export default defineConfig({
  plugins: [react()],
  base: '/app/',
  build: {
    outDir: '../public/app',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4321' }
  }
});
