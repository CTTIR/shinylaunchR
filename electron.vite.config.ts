import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const sharedAlias = {
  '@shared': resolve('src/shared'),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: [] })],
    resolve: { alias: sharedAlias },
    build: {
      outDir: resolve('out/main'),
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
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias },
    build: {
      outDir: resolve('out/preload'),
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
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
      },
    },
  },
});
