import { beforeAll, afterAll, beforeEach } from 'vitest';
import dotenv from 'dotenv';
import path from 'path';
import { db } from '../database/index.js';
import { migrateToLatest } from '../database/migrator.js';
import { getConnection } from '../queue/connection.js';
import { CacheManager } from '../utils/cache.js';
import { Reservoir } from '@logtide/reservoir';

// Load test environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

/**
 * Global setup - runs once before all tests
 */
beforeAll(async () => {
    console.log('Setting up test environment...');

    try {
        // Verify database connection
        await db.selectFrom('users').selectAll().execute();
        console.log('Database connection established');

        // Run migrations to ensure schema is up-to-date
        console.log('Running database migrations...');
        await migrateToLatest();
        console.log('Database migrations completed');
        
        try {
            const dbUrl = process.env.DATABASE_URL;
            if (dbUrl) {
                // Use URL parser to extract connection parts
                const normalized = dbUrl.startsWith('postgresql://') ? dbUrl.replace('postgresql://', 'postgres://') : dbUrl;
                const url = new URL(normalized);
                const reservoirMigrator = new Reservoir('timescale', {
                    host: url.hostname,
                    port: Number(url.port) || 5432,
                    database: url.pathname.replace(/^\//, ''),
                    username: url.username,
                    password: url.password,
                }, { skipInitialize: false });
                await reservoirMigrator.initialize();
            }
        } catch (err) {
            console.warn('Reservoir initialization for tests failed:', err);
        }
    } catch (error) {
        const isConnRefused = (function check(err: unknown): boolean {
            if (err instanceof AggregateError) return err.errors.some(check);
            if (err instanceof Error) {
                return (
                    err.message.includes('ECONNREFUSED') ||
                    (err as NodeJS.ErrnoException).code === 'ECONNREFUSED'
                );
            }
            return false;
        })(error);
        if (isConnRefused) {
            console.warn('DB not reachable - running in unit-test mode (no DB cleanup)');
        } else {
            console.error('Failed to connect to test database:', error);
            console.error('Make sure the test database is running (docker-compose.test.yml)');
            throw error;
        }
    }
});

/**
 * Clean up database and Redis before each test
 * This ensures test isolation
 */
beforeEach(async () => {
    // Safety guard: refuse to wipe data if not pointing at the test database
    const dbUrl = process.env.DATABASE_URL ?? '';
    if (!dbUrl.includes(':5433') && !dbUrl.includes('test')) {
        throw new Error(
            `ABORT: DATABASE_URL does not look like a test database.\n` +
            `Got: ${dbUrl}\n` +
            `Tests must run against the test DB (port 5433). Do NOT run tests with .env.prod loaded.`
        );
    }

    // Clear Redis rate limit keys to prevent 429 errors in tests
    // @fastify/rate-limit uses keys starting with 'rl:'
    const redis = getConnection();
    if (redis && redis.status === 'ready') {
        try {
            const rateLimitKeys = await redis.keys('rl:*');
            if (rateLimitKeys.length > 0) {
                await redis.del(...rateLimitKeys);
            }
        } catch {
            // Redis not available - unit-test mode
        }
    }

    // Delete all data from tables in reverse dependency order
    try {
        await db.deleteFrom('logs').execute();
        await db.deleteFrom('spans').execute();
        await db.deleteFrom('metrics').execute();
        await db.deleteFrom('alert_history').execute();
        // Digest tables (must delete recipients before configs)
        await db.deleteFrom('digest_recipients').execute();
        await db.deleteFrom('digest_configs').execute();
        // Monitoring tables (must delete before monitors and incidents)
        await db.deleteFrom('monitor_results').execute();
        await db.deleteFrom('monitor_status').execute();
        await db.deleteFrom('monitor_channels').execute();
        await db.deleteFrom('monitors').execute();
        // Status page tables
        await db.deleteFrom('status_incident_updates').execute();
        await db.deleteFrom('status_incidents').execute();
        await db.deleteFrom('scheduled_maintenances').execute();
        // Pipeline tables
        await db.deleteFrom('log_pipelines').execute();
        // Custom dashboards
        await db.deleteFrom('custom_dashboards').execute();
        // SIEM tables (must delete before incidents and sigma_rules)
        await db.deleteFrom('incident_alerts').execute();
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
        await db.deleteFrom('audit_log').execute();
        await db.deleteFrom('sessions').execute();
        await db.deleteFrom('users').execute();
        // Reset system_settings so cross-test pollution of `auth.mode`
        // (standard vs none) doesn't cause 401 assertions to flip to 503.
        await db.deleteFrom('system_settings').execute();
        await CacheManager.invalidateSettings();
    } catch (err) {
        // Only skip cleanup if DB is not reachable
        if (err instanceof Error && err.message.includes('ECONNREFUSED')) {
            return;
        }
        throw err;
    }
});

/**
 * Global teardown - runs once after all tests
 */
afterAll(async () => {
    console.log('Cleaning up test environment...');

    // Close Redis connection
    const redis = getConnection();
    if (redis) await redis.quit();

    // Close database connection
    await db.destroy();

    console.log('Test environment cleaned up');
});
