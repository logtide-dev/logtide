import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [
    svelte({ hot: false }),
    svelteTesting(),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test-setup.ts'],
  },
  resolve: {
    conditions: ['browser'],
    alias: {
      // Use fileURLToPath so paths with spaces are decoded correctly
      // (new URL().pathname encodes spaces as %20 which breaks Vite resolution)
      $lib: path.resolve(__dirname, 'src/lib'),
      '@logtide/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
