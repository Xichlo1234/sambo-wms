import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': '/src' } },
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1500 },
});
