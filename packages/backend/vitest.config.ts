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
            include: ['src/**/*.ts'],
            reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
            reportsDirectory: './coverage',
            exclude: [
                'node_modules/',
                'dist/',
                'src/tests/',
                'src/scripts/',
                'scripts/',
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
                // Exclude hard-to-test infrastructure files
                'src/queue/adapters/*.ts',
                'src/queue/index.ts',
            ],
            thresholds: {
                lines: 80,
                functions: 80,
                branches: 80,
                statements: 80,
            },
        },
        testTimeout: 30000, // 30 seconds for integration tests
        hookTimeout: 30000,
        teardownTimeout: 10000,
        fileParallelism: false, // Run test files sequentially to avoid DB conflicts
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
