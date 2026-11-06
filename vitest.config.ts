import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve('src/main'),
      '@preload': resolve('src/preload'),
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/main/**', 'src/shared/**'],
      reporter: ['text', 'html'],
    },
  },
});
