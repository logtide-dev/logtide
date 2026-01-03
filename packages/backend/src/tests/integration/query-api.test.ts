import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { build } from '../../server.js';
import { createTestContext, createTestLog } from '../helpers/index.js';
import { db } from '../../database/index.js';
import type { FastifyInstance } from 'fastify';

describe('Query API Integration Tests', () => {
    let app: FastifyInstance;
    let apiKey: string;
    let projectId: string;
    let userId: string;
    let organizationId: string;

    beforeEach(async () => {
        // Create test context (user, org, project, API key)
        const context = await createTestContext();
        apiKey = context.apiKey.plainKey; // Use the plain key for Authorization header
        projectId = context.project.id;
        userId = context.user.id;
        organizationId = context.organization.id;

        // Build Fastify app
        app = await build();
        await app.ready();
    });

    describe('GET /api/v1/logs - Search and Filter Logs', () => {
        beforeEach(async () => {
            // Insert test logs with various properties
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
            const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

            await createTestLog({
                projectId,
                time: now,
                service: 'api',
                level: 'info',
                message: 'User login successful',
                metadata: { userId: 'user123' },
            });

            await createTestLog({
                projectId,
                time: oneHourAgo,
                service: 'api',
                level: 'error',
                message: 'Database connection failed',
                metadata: { error: 'ECONNREFUSED' },
            });

            await createTestLog({
                projectId,
                time: twoHoursAgo,
                service: 'worker',
                level: 'warn',
                message: 'High memory usage detected',
            });

            await createTestLog({
                projectId,
                time: now,
                service: 'worker',
                level: 'info',
                message: 'Task completed successfully',
                trace_id: '550e8400-e29b-41d4-a716-446655440001',
            });
        });

        it('should return all logs without filters', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body).toHaveProperty('logs');
            expect(response.body.logs).toBeInstanceOf(Array);
            expect(response.body.logs.length).toBeGreaterThan(0);
        });

        it('should filter logs by service', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId, service: 'api' })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.logs).toBeInstanceOf(Array);
            response.body.logs.forEach((log: any) => {
                expect(log.service).toBe('api');
            });
        });

        it('should filter logs by level', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId, level: 'error' })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.logs).toBeInstanceOf(Array);
            response.body.logs.forEach((log: any) => {
                expect(log.level).toBe('error');
            });
        });

        it('should filter logs by multiple levels', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId, level: ['info', 'warn'] })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.logs).toBeInstanceOf(Array);
            response.body.logs.forEach((log: any) => {
                expect(['info', 'warn']).toContain(log.level);
            });
        });

        it('should filter logs by time range', async () => {
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

            const response = await request(app.server)
                .get('/api/v1/logs')
                .query({
                    projectId,
                    from: oneHourAgo.toISOString(),
                    to: now.toISOString(),
                })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.logs).toBeInstanceOf(Array);
            response.body.logs.forEach((log: any) => {
                const logTime = new Date(log.time);
                expect(logTime.getTime()).toBeGreaterThanOrEqual(oneHourAgo.getTime());
                expect(logTime.getTime()).toBeLessThanOrEqual(now.getTime());
            });
        });

        it('should filter logs by full-text search (message)', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId, q: 'Database' })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.logs).toBeInstanceOf(Array);
            expect(response.body.logs.length).toBeGreaterThan(0);
            expect(response.body.logs[0].message).toContain('Database');
        });

        it('should filter logs by trace_id', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId, traceId: '550e8400-e29b-41d4-a716-446655440001' })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.logs).toBeInstanceOf(Array);
            response.body.logs.forEach((log: any) => {
                expect(log.traceId).toBe('550e8400-e29b-41d4-a716-446655440001');
            });
        });

        it('should combine multiple filters (service + level + time)', async () => {
            const now = new Date();
            const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

            const response = await request(app.server)
                .get('/api/v1/logs')
                .query({
                    projectId,
                    service: 'api',
                    level: 'info',
                    from: twoHoursAgo.toISOString(),
                    to: now.toISOString(),
                })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.logs).toBeInstanceOf(Array);
            response.body.logs.forEach((log: any) => {
                expect(log.service).toBe('api');
                expect(log.level).toBe('info');
            });
        });

        it('should handle pagination with limit and offset', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId, limit: 2, offset: 0 })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.logs).toHaveLength(2);
            expect(response.body).toHaveProperty('total');
        });

        it('should handle empty results', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId, service: 'non-existent-service' })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.logs).toHaveLength(0);
        });

        it('should require authentication', async () => {
            await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId })
                .expect(401);
        });

        it('should reject invalid API key', async () => {
            await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId })
                .set('x-api-key', 'invalid_key')
                .expect(401);
        });


    });

    describe('GET /api/v1/logs - Substring Search Mode (Issue #68)', () => {
        beforeEach(async () => {
            // Insert test logs with various message patterns for substring testing
            const now = new Date();

            // Log with compound words (e.g., "spa.bluez5.native")
            await createTestLog({
                projectId,
                time: now,
                service: 'audio',
                level: 'info',
                message: 'PipeWire spa.bluez5.native connected to device',
            });

            // Log with hyphenated terms
            await createTestLog({
                projectId,
                time: now,
                service: 'network',
                level: 'error',
                message: 'Connection to api-gateway-v2.internal.svc failed',
            });

            // Log with underscored terms
            await createTestLog({
                projectId,
                time: now,
                service: 'db',
                level: 'warn',
                message: 'Query on user_profile_settings_v3 took 500ms',
            });

            // Log with normal words (for fulltext comparison)
            await createTestLog({
                projectId,
                time: now,
                service: 'api',
                level: 'info',
                message: 'User authentication completed successfully',
            });

            // Log with special LIKE characters to test escaping
            await createTestLog({
                projectId,
                time: now,
                service: 'search',
                level: 'debug',
                message: 'Query: SELECT * FROM logs WHERE status = 100% AND type_id = 5',
            });
        });

        it('should find text anywhere in message with substring mode', async () => {
            // "bluez" should match "spa.bluez5.native" with substring mode
            const response = await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId, q: 'bluez', searchMode: 'substring' })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.logs).toBeInstanceOf(Array);
            expect(response.body.logs.length).toBeGreaterThan(0);
            expect(response.body.logs[0].message).toContain('bluez');
        });

        it('should NOT find partial text with default fulltext mode', async () => {
            // "bluez" should NOT match "spa.bluez5.native" with fulltext mode
            // because fulltext search is word-based and "bluez5" is treated as one word
            const response = await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId, q: 'bluez' })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.logs).toBeInstanceOf(Array);
            // Fulltext won't find "bluez" inside "spa.bluez5.native"
            expect(response.body.logs.length).toBe(0);
        });

        it('should find hyphenated terms with substring mode', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId, q: 'gateway-v2', searchMode: 'substring' })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.logs).toBeInstanceOf(Array);
            expect(response.body.logs.length).toBeGreaterThan(0);
            expect(response.body.logs[0].message).toContain('gateway-v2');
        });

        it('should find underscored terms with substring mode', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId, q: 'profile_settings', searchMode: 'substring' })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.logs).toBeInstanceOf(Array);
            expect(response.body.logs.length).toBeGreaterThan(0);
            expect(response.body.logs[0].message).toContain('profile_settings');
        });

        it('should handle special LIKE characters (% and _) safely', async () => {
            // Search for "100%" - the % should be escaped and not act as wildcard
            const response = await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId, q: '100%', searchMode: 'substring' })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.logs).toBeInstanceOf(Array);
            expect(response.body.logs.length).toBeGreaterThan(0);
            expect(response.body.logs[0].message).toContain('100%');
        });

        it('should handle underscore character safely', async () => {
            // Search for "type_id" - the _ should be escaped and not act as single-char wildcard
            const response = await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId, q: 'type_id', searchMode: 'substring' })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.logs).toBeInstanceOf(Array);
            expect(response.body.logs.length).toBeGreaterThan(0);
            expect(response.body.logs[0].message).toContain('type_id');
        });

        it('should default to fulltext mode when searchMode not specified', async () => {
            // "authentication" is a normal word, should be found with fulltext
            const response = await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId, q: 'authentication' })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.logs).toBeInstanceOf(Array);
            expect(response.body.logs.length).toBeGreaterThan(0);
            expect(response.body.logs[0].message).toContain('authentication');
        });

        it('should reject invalid searchMode value', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId, q: 'test', searchMode: 'invalid' })
                .set('x-api-key', apiKey)
                .expect(400);

            expect(response.body).toHaveProperty('message');
        });

        it('should return different results for fulltext vs substring mode', async () => {
            // Get results with fulltext mode
            const fulltextResponse = await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId, q: 'bluez', searchMode: 'fulltext' })
                .set('x-api-key', apiKey)
                .expect(200);

            // Get results with substring mode
            const substringResponse = await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId, q: 'bluez', searchMode: 'substring' })
                .set('x-api-key', apiKey)
                .expect(200);

            // Fulltext should not find "bluez" (it's part of "bluez5")
            expect(fulltextResponse.body.logs.length).toBe(0);
            // Substring should find it
            expect(substringResponse.body.logs.length).toBeGreaterThan(0);
        });

        it('should be case-insensitive in substring mode', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId, q: 'BLUEZ', searchMode: 'substring' })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.logs).toBeInstanceOf(Array);
            expect(response.body.logs.length).toBeGreaterThan(0);
            // Original message has lowercase "bluez"
            expect(response.body.logs[0].message.toLowerCase()).toContain('bluez');
        });
    });

    describe('GET /api/v1/logs/trace/:traceId - Get Logs by Trace ID', () => {
        beforeEach(async () => {
            // Insert logs with same trace ID
            await createTestLog({
                projectId,
                service: 'api',
                level: 'info',
                message: 'Request received',
                trace_id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
            });

            await createTestLog({
                projectId,
                service: 'database',
                level: 'info',
                message: 'Query executed',
                trace_id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
            });

            await createTestLog({
                projectId,
                service: 'cache',
                level: 'info',
                message: 'Cache hit',
                trace_id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
            });

            // Different trace
            await createTestLog({
                projectId,
                service: 'api',
                level: 'info',
                message: 'Other request',
                trace_id: '6ba7b811-9dad-11d1-80b4-00c04fd430c9',
            });
        });

        it('should return all logs for a specific trace ID', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs/trace/6ba7b810-9dad-11d1-80b4-00c04fd430c8')
                .query({ projectId })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.logs).toHaveLength(3);
            response.body.logs.forEach((log: any) => {
                expect(log.traceId).toBe('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
            });
        });

        it('should return empty array for non-existent trace ID', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs/trace/00000000-0000-0000-0000-000000000000')
                .query({ projectId })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.logs).toHaveLength(0);
        });

        it('should require authentication', async () => {
            await request(app.server)
                .get('/api/v1/logs/trace/6ba7b810-9dad-11d1-80b4-00c04fd430c8')
                .query({ projectId })
                .expect(401);
        });
    });

    describe('GET /api/v1/logs/context - Get Log Context', () => {
        beforeEach(async () => {
            const now = new Date();

            // Insert logs around a specific time
            for (let i = -10; i <= 10; i++) {
                const time = new Date(now.getTime() + i * 1000); // 1 second intervals
                await createTestLog({
                    projectId,
                    time,
                    service: 'test',
                    level: 'info',
                    message: `Log ${i}`,
                });
            }
        });

        it('should return logs before and after a specific time', async () => {
            const now = new Date();

            const response = await request(app.server)
                .get('/api/v1/logs/context')
                .query({
                    projectId,
                    time: now.toISOString(),
                    before: 5,
                    after: 5,
                })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body).toHaveProperty('before');
            expect(response.body).toHaveProperty('after');
            expect(response.body.before).toHaveLength(5);
            expect(response.body.after).toHaveLength(5);
        });

        it('should use default before/after values (10)', async () => {
            const now = new Date();

            const response = await request(app.server)
                .get('/api/v1/logs/context')
                .query({
                    projectId,
                    time: now.toISOString(),
                })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.before.length).toBeLessThanOrEqual(10);
            expect(response.body.after.length).toBeLessThanOrEqual(10);
        });

        it('should require time parameter', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs/context')
                .query({ projectId })
                .set('x-api-key', apiKey)
                .expect(400);

            expect(response.body).toHaveProperty('error');
        });
    });

    describe('GET /api/v1/logs/aggregated - Get Aggregated Statistics', () => {
        beforeEach(async () => {
            const now = new Date();

            // Insert logs with different levels
            for (let i = 0; i < 5; i++) {
                await createTestLog({
                    projectId,
                    time: now,
                    service: 'api',
                    level: 'info',
                    message: `Info log ${i}`,
                });
            }

            for (let i = 0; i < 3; i++) {
                await createTestLog({
                    projectId,
                    time: now,
                    service: 'api',
                    level: 'error',
                    message: `Error log ${i}`,
                });
            }
        });

        it('should return aggregated statistics with time buckets', async () => {
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

            const response = await request(app.server)
                .get('/api/v1/logs/aggregated')
                .query({
                    projectId,
                    from: oneHourAgo.toISOString(),
                    to: now.toISOString(),
                    interval: '1h',
                })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body).toHaveProperty('timeseries');
            expect(response.body.timeseries).toBeInstanceOf(Array);
        });

        it('should filter by service', async () => {
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

            const response = await request(app.server)
                .get('/api/v1/logs/aggregated')
                .query({
                    projectId,
                    service: 'api',
                    from: oneHourAgo.toISOString(),
                    to: now.toISOString(),
                })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body).toHaveProperty('timeseries');
        });

        it('should require from and to parameters', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs/aggregated')
                .query({ projectId })
                .set('x-api-key', apiKey)
                .expect(400);

            expect(response.body).toHaveProperty('error');
        });
    });

    describe('GET /api/v1/logs/top-services - Get Top Services', () => {
        beforeEach(async () => {
            // Insert logs for different services
            for (let i = 0; i < 10; i++) {
                await createTestLog({ projectId, service: 'api', level: 'info', message: `API log ${i}` });
            }

            for (let i = 0; i < 5; i++) {
                await createTestLog({ projectId, service: 'worker', level: 'info', message: `Worker log ${i}` });
            }

            for (let i = 0; i < 3; i++) {
                await createTestLog({ projectId, service: 'cache', level: 'info', message: `Cache log ${i}` });
            }
        });

        it('should return top services by log count', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs/top-services')
                .query({ projectId, limit: 5 })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.services).toBeInstanceOf(Array);
            expect(response.body.services[0]).toHaveProperty('service');
            expect(response.body.services[0]).toHaveProperty('count');

            // Services should be ordered by count (descending)
            expect(response.body.services[0].service).toBe('api');
            expect(Number(response.body.services[0].count)).toBeGreaterThanOrEqual(10);
        });

        it('should respect limit parameter', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs/top-services')
                .query({ projectId, limit: 2 })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.services.length).toBeLessThanOrEqual(2);
        });

        it('should filter by time range', async () => {
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

            const response = await request(app.server)
                .get('/api/v1/logs/top-services')
                .query({
                    projectId,
                    from: oneHourAgo.toISOString(),
                    to: now.toISOString(),
                })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.services).toBeInstanceOf(Array);
        });
    });

    describe('GET /api/v1/logs/top-errors - Get Top Errors', () => {
        beforeEach(async () => {
            // Insert error logs
            for (let i = 0; i < 5; i++) {
                await createTestLog({
                    projectId,
                    level: 'error',
                    service: 'api',
                    message: 'Database connection timeout',
                });
            }

            for (let i = 0; i < 3; i++) {
                await createTestLog({
                    projectId,
                    level: 'error',
                    service: 'api',
                    message: 'Invalid user credentials',
                });
            }

            for (let i = 0; i < 2; i++) {
                await createTestLog({
                    projectId,
                    level: 'critical',
                    service: 'worker',
                    message: 'Out of memory',
                });
            }
        });

        it('should return top error messages', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs/top-errors')
                .query({ projectId, limit: 10 })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.errors).toBeInstanceOf(Array);
            expect(response.body.errors[0]).toHaveProperty('message');
            expect(response.body.errors[0]).toHaveProperty('count');

            // Errors should be ordered by count (descending)
            expect(response.body.errors[0].message).toBe('Database connection timeout');
        });

        it('should respect limit parameter', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs/top-errors')
                .query({ projectId, limit: 2 })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.errors.length).toBeLessThanOrEqual(2);
        });

        it('should require authentication', async () => {
            await request(app.server)
                .get('/api/v1/logs/top-errors')
                .expect(401);
        });
    });

    describe('GET /api/v1/logs/:logId - Get Single Log', () => {
        let testLogId: string;

        beforeEach(async () => {
            // Insert a test log and capture its ID
            const result = await db
                .insertInto('logs')
                .values({
                    project_id: projectId,
                    time: new Date(),
                    service: 'test-service',
                    level: 'info',
                    message: 'Test log for single retrieval',
                    metadata: { testKey: 'testValue' },
                })
                .returning(['id'])
                .executeTakeFirstOrThrow();

            testLogId = result.id;
        });

        it('should return a single log by ID', async () => {
            const response = await request(app.server)
                .get(`/api/v1/logs/${testLogId}`)
                .query({ projectId })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body).toHaveProperty('log');
            expect(response.body.log.id).toBe(testLogId);
            expect(response.body.log.message).toBe('Test log for single retrieval');
        });

        it('should return 404 for non-existent log', async () => {
            const fakeId = '00000000-0000-0000-0000-000000000000';
            const response = await request(app.server)
                .get(`/api/v1/logs/${fakeId}`)
                .query({ projectId })
                .set('x-api-key', apiKey)
                .expect(404);

            expect(response.body.error).toBe('Log not found');
        });

        it('should require authentication', async () => {
            await request(app.server)
                .get(`/api/v1/logs/${testLogId}`)
                .query({ projectId })
                .expect(401);
        });

        it('should use projectId from API key association when not provided', async () => {
            // The API key has projectId associated, so request succeeds without explicit projectId
            const response = await request(app.server)
                .get(`/api/v1/logs/${testLogId}`)
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body).toHaveProperty('log');
        });
    });

    describe('GET /api/v1/logs/services - Get Distinct Services', () => {
        beforeEach(async () => {
            // Insert logs with different services
            await createTestLog({ projectId, service: 'api-gateway', level: 'info', message: 'Log 1' });
            await createTestLog({ projectId, service: 'auth-service', level: 'info', message: 'Log 2' });
            await createTestLog({ projectId, service: 'user-service', level: 'info', message: 'Log 3' });
            await createTestLog({ projectId, service: 'api-gateway', level: 'error', message: 'Log 4' });
        });

        it('should return distinct services', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs/services')
                .query({ projectId })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.services).toBeInstanceOf(Array);
            expect(response.body.services.length).toBeGreaterThanOrEqual(3);
            expect(response.body.services).toContain('api-gateway');
            expect(response.body.services).toContain('auth-service');
            expect(response.body.services).toContain('user-service');
        });

        it('should filter by time range', async () => {
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

            const response = await request(app.server)
                .get('/api/v1/logs/services')
                .query({
                    projectId,
                    from: oneHourAgo.toISOString(),
                    to: now.toISOString(),
                })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.services).toBeInstanceOf(Array);
        });

        it('should reject invalid from date format', async () => {
            // Fastify schema validation catches invalid date formats
            await request(app.server)
                .get('/api/v1/logs/services')
                .query({ projectId, from: 'invalid-date' })
                .set('x-api-key', apiKey)
                .expect(400);
        });

        it('should reject invalid to date format', async () => {
            // Fastify schema validation catches invalid date formats
            await request(app.server)
                .get('/api/v1/logs/services')
                .query({ projectId, to: 'not-a-date' })
                .set('x-api-key', apiKey)
                .expect(400);
        });

        it('should require authentication', async () => {
            await request(app.server)
                .get('/api/v1/logs/services')
                .expect(401);
        });

        it('should support multiple projectIds', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs/services')
                .query({ projectId: [projectId] })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.services).toBeInstanceOf(Array);
        });
    });

    describe('Authentication Tests', () => {
        it('should work with API key that has projectId association', async () => {
            // The API key created by createTestContext has a projectId association
            // So requests without explicit projectId still work
            const response = await request(app.server)
                .get('/api/v1/logs')
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body).toHaveProperty('logs');
        });

        it('should require authentication for logs endpoint', async () => {
            await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId })
                .expect(401);
        });

        it('should require authentication for trace endpoint', async () => {
            await request(app.server)
                .get('/api/v1/logs/trace/some-trace-id')
                .query({ projectId })
                .expect(401);
        });

        it('should require authentication for context endpoint', async () => {
            await request(app.server)
                .get('/api/v1/logs/context')
                .query({ projectId, time: new Date().toISOString() })
                .expect(401);
        });

        it('should require from/to for aggregated endpoint', async () => {
            // Without from/to, the request should fail with 400 (Fastify schema validation)
            const response = await request(app.server)
                .get('/api/v1/logs/aggregated')
                .query({ projectId })
                .set('x-api-key', apiKey)
                .expect(400);

            expect(response.body).toHaveProperty('message');
        });

        it('should require authentication for top-services endpoint', async () => {
            await request(app.server)
                .get('/api/v1/logs/top-services')
                .query({ projectId })
                .expect(401);
        });
    });

    describe('Multiple Levels and Services Filter', () => {
        beforeEach(async () => {
            await createTestLog({ projectId, service: 'service-a', level: 'info', message: 'A Info' });
            await createTestLog({ projectId, service: 'service-b', level: 'warn', message: 'B Warn' });
            await createTestLog({ projectId, service: 'service-a', level: 'error', message: 'A Error' });
            await createTestLog({ projectId, service: 'service-c', level: 'debug', message: 'C Debug' });
        });

        it('should filter by multiple services', async () => {
            const response = await request(app.server)
                .get('/api/v1/logs')
                .query({ projectId, service: ['service-a', 'service-b'] })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.logs).toBeInstanceOf(Array);
            response.body.logs.forEach((log: any) => {
                expect(['service-a', 'service-b']).toContain(log.service);
            });
        });
    });
});
