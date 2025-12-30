import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { build } from '../../server.js';
import { createTestApiKey } from '../helpers/index.js';
import { db } from '../../database/index.js';

describe('Ingestion API', () => {
    let app: any;
    let apiKey: string;
    let projectId: string;

    // Create app once for all tests
    beforeEach(async () => {
        if (!app) {
            app = await build();
            await app.ready();
        }

        // Create fresh API key for each test (after global cleanup)
        const testKey = await createTestApiKey({ name: 'Test Ingestion Key' });
        apiKey = testKey.plainKey;
        projectId = testKey.project_id;
    });

    afterAll(async () => {
        // Close app after all tests
        if (app) {
            await app.close();
        }
    });

    describe('POST /api/v1/ingest - Batch Ingestion', () => {
        it('should ingest valid batch of logs', async () => {
            const logs = [
                {
                    time: new Date().toISOString(),
                    service: 'test-service',
                    level: 'info',
                    message: 'Test log message 1',
                },
                {
                    time: new Date().toISOString(),
                    service: 'test-service',
                    level: 'error',
                    message: 'Test log message 2',
                    metadata: { userId: '123' },
                },
            ];

            const response = await request(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', apiKey)
                .send({ logs })
                .expect(200);

            expect(response.body).toHaveProperty('received', 2);
            expect(response.body).toHaveProperty('timestamp');
        });

        it('should reject empty batch', async () => {
            const response = await request(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', apiKey)
                .send({ logs: [] })
                .expect(400);

            expect(response.body).toHaveProperty('error');
        });

        it('should reject request without API key', async () => {
            const logs = [
                {
                    time: new Date().toISOString(),
                    service: 'test',
                    level: 'info',
                    message: 'Test',
                },
            ];

            await request(app.server)
                .post('/api/v1/ingest')
                .send({ logs })
                .expect(401);
        });

        it('should reject invalid API key', async () => {
            const logs = [
                {
                    time: new Date().toISOString(),
                    service: 'test',
                    level: 'info',
                    message: 'Test',
                },
            ];

            await request(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', 'invalid_key_123')
                .send({ logs })
                .expect(401);
        });

        it('should validate log schema', async () => {
            const invalidLogs = [
                {
                    // Missing required fields
                    time: new Date().toISOString(),
                    // service: missing
                    level: 'info',
                    message: 'Test',
                },
            ];

            const response = await request(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', apiKey)
                .send({ logs: invalidLogs })
                .expect(400);

            expect(response.body).toHaveProperty('error');
        });

        it('should handle logs with metadata', async () => {
            const logs = [
                {
                    time: new Date().toISOString(),
                    service: 'api',
                    level: 'info',
                    message: 'User login',
                    metadata: {
                        userId: '123',
                        ip: '192.168.1.1',
                        userAgent: 'Mozilla/5.0',
                    },
                },
            ];

            const response = await request(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', apiKey)
                .send({ logs })
                .expect(200);

            expect(response.body.received).toBe(1);
        });

        it('should handle logs with trace_id', async () => {
            const traceId = '550e8400-e29b-41d4-a716-446655440000'; // Valid UUID v4
            const logs = [
                {
                    time: new Date().toISOString(),
                    service: 'api',
                    level: 'info',
                    message: 'Request processed',
                    trace_id: traceId,
                },
            ];

            await request(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', apiKey)
                .send({ logs })
                .expect(200);
        });

        it('should handle large batch (100 logs)', async () => {
            const timestamp = Date.now();
            const logs = Array.from({ length: 100 }, (_, i) => ({
                time: new Date().toISOString(),
                service: 'test-service',
                level: 'info',
                message: `Log message ${timestamp}-${i}`,
            }));

            const response = await request(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', apiKey)
                .send({ logs })
                .expect(200);

            expect(response.body.received).toBe(100);
        });
    });

    describe('POST /api/v1/ingest/single - Single Log Ingestion (Fluent Bit)', () => {
        it('should ingest single log', async () => {
            const log = {
                time: new Date().toISOString(),
                service: 'nginx',
                level: 'info',
                message: 'GET /api/health 200',
            };

            const response = await request(app.server)
                .post('/api/v1/ingest/single')
                .set('x-api-key', apiKey)
                .send(log)
                .expect(200);

            expect(response.body.received).toBe(1);
        });

        it('should handle Fluent Bit format with container_name', async () => {
            const log = {
                date: Math.floor(Date.now() / 1000),
                container_name: 'my-container',
                log: 'Container log message',
                level: 'info',
            };

            await request(app.server)
                .post('/api/v1/ingest/single')
                .set('x-api-key', apiKey)
                .send(log)
                .expect(200);
        });

        it('should normalize numeric log levels (Pino format)', async () => {
            const testCases = [
                { level: 60, expected: 'critical' },
                { level: 50, expected: 'error' },
                { level: 40, expected: 'warn' },
                { level: 30, expected: 'info' },
                { level: 20, expected: 'debug' },
            ];

            for (const { level, expected } of testCases) {
                const uniqueMsg = `Pino-test-${level}-${Date.now()}`;

                await request(app.server)
                    .post('/api/v1/ingest/single')
                    .set('x-api-key', apiKey)
                    .send({
                        time: new Date().toISOString(),
                        service: 'test',
                        level,
                        message: uniqueMsg,
                    })
                    .expect(200);

                const dbLog = await db
                    .selectFrom('logs')
                    .selectAll()
                    .where('message', '=', uniqueMsg)
                    .executeTakeFirst();

                expect(dbLog?.level).toBe(expected);
            }
        });

        it('should normalize syslog levels to LogWard levels', async () => {
            const testCases = [
                // Critical levels
                { level: 'emergency', expected: 'critical' },
                { level: 'emerg', expected: 'critical' },
                { level: 'alert', expected: 'critical' },
                { level: 'crit', expected: 'critical' },
                { level: 'fatal', expected: 'critical' },
                // Error levels
                { level: 'err', expected: 'error' },
                // Warning levels
                { level: 'warning', expected: 'warn' },
                // Info levels (notice maps to info)
                { level: 'notice', expected: 'info' },
                { level: 'information', expected: 'info' },
                // Debug levels
                { level: 'trace', expected: 'debug' },
                { level: 'verbose', expected: 'debug' },
            ];

            for (const { level, expected } of testCases) {
                const uniqueMsg = `Syslog-test-${level}-${Date.now()}-${Math.random()}`;

                await request(app.server)
                    .post('/api/v1/ingest/single')
                    .set('x-api-key', apiKey)
                    .send({
                        time: new Date().toISOString(),
                        service: 'test-syslog',
                        level,
                        message: uniqueMsg,
                    })
                    .expect(200);

                const dbLog = await db
                    .selectFrom('logs')
                    .selectAll()
                    .where('message', '=', uniqueMsg)
                    .executeTakeFirst();

                expect(dbLog?.level, `Level "${level}" should map to "${expected}"`).toBe(expected);
            }
        });

        it('should handle case-insensitive syslog levels', async () => {
            const testCases = [
                { level: 'NOTICE', expected: 'info' },
                { level: 'Warning', expected: 'warn' },
                { level: 'ERROR', expected: 'error' },
                { level: 'CRITICAL', expected: 'critical' },
            ];

            for (const { level, expected } of testCases) {
                const uniqueMsg = `Syslog-case-test-${level}-${Date.now()}-${Math.random()}`;

                await request(app.server)
                    .post('/api/v1/ingest/single')
                    .set('x-api-key', apiKey)
                    .send({
                        time: new Date().toISOString(),
                        service: 'test-syslog-case',
                        level,
                        message: uniqueMsg,
                    })
                    .expect(200);

                const dbLog = await db
                    .selectFrom('logs')
                    .selectAll()
                    .where('message', '=', uniqueMsg)
                    .executeTakeFirst();

                expect(dbLog?.level, `Level "${level}" should map to "${expected}"`).toBe(expected);
            }
        });

        it('should handle NDJSON content type', async () => {
            const log = {
                time: new Date().toISOString(),
                service: 'test',
                level: 'info',
                message: 'NDJSON test',
            };

            await request(app.server)
                .post('/api/v1/ingest/single')
                .set('x-api-key', apiKey)
                .set('Content-Type', 'application/x-ndjson')
                .send(JSON.stringify(log))
                .expect(200);
        });
    });

    describe('GET /api/v1/stats - Statistics', () => {
        it('should return log statistics', async () => {
            // Insert some test data first
            await request(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', apiKey)
                .send({
                    logs: [
                        {
                            time: new Date().toISOString(),
                            service: 'test',
                            level: 'info',
                            message: 'Test info',
                        },
                        {
                            time: new Date().toISOString(),
                            service: 'test',
                            level: 'error',
                            message: 'Test error',
                        },
                    ],
                });

            const response = await request(app.server)
                .get('/api/v1/stats')
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body).toHaveProperty('total');
            expect(response.body).toHaveProperty('by_level');
            expect(response.body.total).toBeGreaterThan(0);
        });

        it('should filter by time range', async () => {
            const now = new Date();
            const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

            const response = await request(app.server)
                .get('/api/v1/stats')
                .query({
                    from: hourAgo.toISOString(),
                    to: now.toISOString(),
                })
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body.total).toBeGreaterThanOrEqual(0);
        });

        it('should require authentication', async () => {
            await request(app.server)
                .get('/api/v1/stats')
                .expect(401);
        });
    });

    describe('Error Handling', () => {
        it('should handle malformed JSON', async () => {
            await request(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', apiKey)
                .set('Content-Type', 'application/json')
                .send('invalid json{')
                .expect(400);
        });

        it('should handle missing request body', async () => {
            const response = await request(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', apiKey)
                .send({})
                .expect(400);

            expect(response.body).toHaveProperty('error');
        });

        it('should handle invalid log level', async () => {
            const logs = [
                {
                    time: new Date().toISOString(),
                    service: 'test',
                    level: 'invalid-level',
                    message: 'Test',
                },
            ];

            const response = await request(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', apiKey)
                .send({ logs })
                .expect(400);

            expect(response.body).toHaveProperty('error');
        });

        it('should handle invalid timestamp format', async () => {
            const logs = [
                {
                    time: 'not-a-date',
                    service: 'test',
                    level: 'info',
                    message: 'Test',
                },
            ];

            const response = await request(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', apiKey)
                .send({ logs })
                .expect(400);

            expect(response.body).toHaveProperty('error');
        });
    });
});
