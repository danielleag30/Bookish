import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Builds the chart engine and ask box into one self-contained ES module the
 * static chart pages load with a single script tag. Output lands in chart/ at
 * the repo root, which is what Vercel serves (see vercel.json).
 */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/engine/index.ts'),
      formats: ['es'],
      fileName: () => 'chart.js',
    },
    outDir: 'chart',
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
  },
});
