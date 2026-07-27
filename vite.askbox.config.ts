import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Builds the ask box into one self-contained ES module the static chart pages
 * can load directly. Output lands in askbox/ at the repo root, which is what
 * Vercel serves (see vercel.json outputDirectory).
 */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/askbox.ts'),
      formats: ['es'],
      fileName: () => 'askbox.js',
    },
    outDir: 'askbox',
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
  },
});
