#!/usr/bin/env node

/**
 * Test runner script
 * Ensures test database is running before executing tests
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '../../../..');

console.log('🧪 LogTide Test Runner\n');

// Check if Docker is available
try {
    execSync('docker --version', { stdio: 'ignore' });
} catch (error) {
    console.error('❌ Docker is not available. Please install Docker to run tests.');
    console.error('   Download: https://www.docker.com/get-started');
    process.exit(1);
}

// Start test database
console.log('📦 Starting test database containers...');
try {
    // Use "docker compose" (with space) for modern Docker / WSL
    execSync('docker compose -f docker-compose.test.yml up -d', {
        cwd: projectRoot,
        stdio: 'inherit',
    });
    console.log('✅ Test database containers started\n');
} catch (error) {
    console.error('❌ Failed to start test database containers');
    console.error('   Make sure Docker is running and accessible');
    process.exit(1);
}

// Wait a bit for containers to be ready
console.log('⏳ Waiting for database to be ready...');
await new Promise(resolve => setTimeout(resolve, 3000));

// Run tests
console.log('🧪 Running tests...\n');
try {
    const args = process.argv.slice(2);
    const vitestCommand = args.length > 0 ? `vitest ${args.join(' ')}` : 'vitest run';

    execSync(vitestCommand, {
        cwd: join(__dirname, '../..'),
        stdio: 'inherit',
    });
} catch (error) {
    process.exit(1);
}
