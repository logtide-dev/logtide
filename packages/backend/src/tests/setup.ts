import { sql } from 'kysely';
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

/** Tables emptied before each test, children before parents (system_settings last). */
const CLEANUP_TABLES = [
    'logs',
    'spans',
    'metrics',
    'alert_history',
    'digest_recipients',
    'digest_configs',
    'monitor_results',
    'monitor_status',
    'monitor_channels',
    'monitors',
    'status_incident_updates',
    'status_incidents',
    'scheduled_maintenances',
    'log_pipelines',
    'custom_dashboards',
    'incident_alerts',
    'incident_comments',
    'incident_history',
    'detection_events',
    'incidents',
    'organization_invitations',
    'sigma_rules',
    'alert_rules',
    'api_keys',
    'notifications',
    'organization_members',
    'projects',
    'organizations',
    'audit_log',
    'sessions',
    'users',
    'system_settings',
];
const CLEANUP_SQL = CLEANUP_TABLES.map((t) => `DELETE FROM ${t}`).join('; ');

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

        // Re-seed the 'local' auth provider (migration 010 seeds it, but tracked
        // migrations never re-run, so a test file that deletes the row would
        // otherwise leave the whole database without local login forever).
        await db
            .insertInto('auth_providers')
            .values({
                type: 'local',
                name: 'Email & Password',
                slug: 'local',
                enabled: true,
                is_default: true,
                display_order: 0,
                icon: 'mail',
                config: {},
            })
            .onConflict((oc) => oc.column('slug').doNothing())
            .execute();

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
        // One round trip for the whole cleanup (it runs before each of the
        // ~7,000 tests): the same DELETEs in the same dependency order.
        await sql.raw(CLEANUP_SQL).execute(db);
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
