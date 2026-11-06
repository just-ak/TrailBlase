import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const alias = {
  '@main': resolve('src/main'),
  '@preload': resolve('src/preload'),
  '@shared': resolve('src/shared'),
  '@renderer': resolve('src/renderer'),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') },
        // ESM, matching "type": "module". Electron 45 supports an ESM main
        // process, and it means `import.meta.dirname` is available rather than
        // the CJS `__dirname` that would be undefined here.
        output: { format: 'es', entryFileNames: '[name].js' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        // A sandboxed preload script must be CommonJS — Electron does not load
        // ESM preloads in a sandboxed renderer. The package is "type": "module",
        // so the output needs an explicit .cjs extension to override that.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react(), tailwindcss()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') },
      },
    },
  },
});
