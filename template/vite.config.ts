import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// SINGLE=1 → alles in eine HTML-Datei (scripts/build-single.mjs hängt danach Daten + Bilder an)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: process.env.SINGLE ? [viteSingleFile({ removeViteModuleLoader: true })] : [],
  build: { outDir: process.env.SINGLE ? 'dist-single' : 'dist', chunkSizeWarningLimit: 1500 },
}));
