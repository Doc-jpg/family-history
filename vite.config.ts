import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base path matches the GitHub Pages project path (https://doc-jpg.github.io/family-history/).
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? '/family-history/',
  build: { outDir: 'dist', sourcemap: false },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
