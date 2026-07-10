import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/types.ts',
      ],
    },
    testTimeout: 10000,
    globalSetup: ['./src/test-global-setup.ts'],
  },
  resolve: {
    alias: {
      // @logtide/shared dist/ is not built; alias directly to source so tests
      // can resolve the package without a build step.
      '@logtide/shared/context': path.resolve(__dirname, '../shared/src/context/index.ts'),
      '@logtide/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
