import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const sharedAlias = {
  '@shared': resolve('src/shared'),
};

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
    build: {
      outDir: resolve('out/main'),
      sourcemap: false,
      lib: {
        entry: resolve('src/main/main.ts'),
        formats: ['cjs'],
      },
      rollupOptions: {
        output: { entryFileNames: 'main.js' },
      },
    },
  },
  preload: {
    resolve: { alias: sharedAlias },
    build: {
      outDir: resolve('out/preload'),
      sourcemap: false,
      lib: {
        entry: resolve('src/main/preload.ts'),
        formats: ['cjs'],
      },
      rollupOptions: {
        output: { entryFileNames: 'preload.js' },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: { alias: sharedAlias },
    plugins: [react()],
    build: {
      outDir: resolve('out/renderer'),
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
      },
    },
  },
});
