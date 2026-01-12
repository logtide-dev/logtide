import { beforeAll, afterAll, beforeEach } from 'vitest';
import dotenv from 'dotenv';
import path from 'path';
import { db } from '../database/index.js';
import { connection } from '../queue/connection.js';

// Load test environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

/**
 * Global setup - runs once before all tests
 */
beforeAll(async () => {
    console.log('🧪 Setting up test environment...');

    try {
        // Verify database connection
        await db.selectFrom('users').selectAll().execute();
        console.log('✅ Database connection established');
    } catch (error) {
        console.error('❌ Failed to connect to test database:', error);
        console.error('Make sure the test database is running (docker-compose.test.yml)');
        throw error;
    }
});

/**
 * Clean up database and Redis before each test
 * This ensures test isolation
 */
beforeEach(async () => {
    // Clear Redis rate limit keys to prevent 429 errors in tests
    // @fastify/rate-limit uses keys starting with 'rl:'
    const rateLimitKeys = await connection.keys('rl:*');
    if (rateLimitKeys.length > 0) {
        await connection.del(...rateLimitKeys);
    }

    // Delete all data from tables in reverse dependency order
    await db.deleteFrom('logs').execute();
    await db.deleteFrom('alert_history').execute();
    // SIEM tables (must delete before incidents and sigma_rules)
    await db.deleteFrom('incident_comments').execute();
    await db.deleteFrom('incident_history').execute();
    await db.deleteFrom('detection_events').execute();
    await db.deleteFrom('incidents').execute();
    await db.deleteFrom('organization_invitations').execute();
    await db.deleteFrom('sigma_rules').execute();
    await db.deleteFrom('alert_rules').execute();
    await db.deleteFrom('api_keys').execute();
    await db.deleteFrom('notifications').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('users').execute();
});

/**
 * Global teardown - runs once after all tests
 */
afterAll(async () => {
    console.log('🧹 Cleaning up test environment...');

    // Close Redis connection
    await connection.quit();

    // Close database connection
    await db.destroy();

    console.log('✅ Test environment cleaned up');
});
