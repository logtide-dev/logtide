import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        globalSetup: './src/tests/globalSetup.ts',
        setupFiles: ['./src/tests/setup.ts'],
        include: ['src/**/*.test.ts'],
        exclude: ['node_modules', 'dist'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
            reportsDirectory: './coverage',
            exclude: [
                'node_modules/',
                'dist/',
                'src/tests/',
                'src/scripts/',
                'migrations/',
                'load-tests/',
                'run-migration.js',
                'analyze-coverage.js',
                'src/worker.ts',
                'src/utils/internal-logging-bootstrap.ts',
                'src/utils/internal-logger.ts',
                '**/*.d.ts',
                '**/*.config.*',
                '**/types.ts',
            ],
            thresholds: {
                lines: 70,
                functions: 70,
                branches: 70,
                statements: 70,
            },
        },
        testTimeout: 30000, // 30 seconds for integration tests
        hookTimeout: 30000,
        teardownTimeout: 10000,
        poolOptions: {
            threads: {
                singleThread: true, // Run tests sequentially to avoid DB conflicts
            },
        },
        fileParallelism: false, // Ensure files run sequentially too
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
