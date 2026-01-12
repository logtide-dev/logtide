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

        it('should normalize syslog levels to LogTide levels', async () => {
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

        // ======================================================================
        // systemd-journald format tests
        // ======================================================================
        it('should detect and handle journald format with _SYSTEMD_UNIT', async () => {
            const uniqueMsg = `journald-systemd-unit-${Date.now()}`;
            const log = {
                MESSAGE: uniqueMsg,
                _SYSTEMD_UNIT: 'nginx.service',
                PRIORITY: '6', // info
                __REALTIME_TIMESTAMP: String(Date.now() * 1000), // microseconds
                _HOSTNAME: 'test-host',
            };

            await request(app.server)
                .post('/api/v1/ingest/single')
                .set('x-api-key', apiKey)
                .send(log)
                .expect(200);

            const dbLog = await db
                .selectFrom('logs')
                .selectAll()
                .where('message', '=', uniqueMsg)
                .executeTakeFirst();

            expect(dbLog).toBeDefined();
            expect(dbLog?.service).toBe('nginx'); // .service suffix removed
            expect(dbLog?.level).toBe('info');
            expect(dbLog?.metadata).toHaveProperty('source', 'journald');
            expect(dbLog?.metadata).toHaveProperty('_HOSTNAME', 'test-host');
        });

        it('should extract service from SYSLOG_IDENTIFIER for journald', async () => {
            const uniqueMsg = `journald-syslog-id-${Date.now()}`;
            const log = {
                MESSAGE: uniqueMsg,
                SYSLOG_IDENTIFIER: 'my-daemon',
                PRIORITY: '4', // warning
            };

            await request(app.server)
                .post('/api/v1/ingest/single')
                .set('x-api-key', apiKey)
                .send(log)
                .expect(200);

            const dbLog = await db
                .selectFrom('logs')
                .selectAll()
                .where('message', '=', uniqueMsg)
                .executeTakeFirst();

            expect(dbLog?.service).toBe('my-daemon');
            expect(dbLog?.level).toBe('warn');
        });

        it('should extract service from _COMM for journald', async () => {
            const uniqueMsg = `journald-comm-${Date.now()}`;
            const log = {
                MESSAGE: uniqueMsg,
                _COMM: 'process-name',
                PRIORITY: '3', // error
            };

            await request(app.server)
                .post('/api/v1/ingest/single')
                .set('x-api-key', apiKey)
                .send(log)
                .expect(200);

            const dbLog = await db
                .selectFrom('logs')
                .selectAll()
                .where('message', '=', uniqueMsg)
                .executeTakeFirst();

            expect(dbLog?.service).toBe('process-name');
            expect(dbLog?.level).toBe('error');
        });

        it('should extract service basename from _EXE path for journald', async () => {
            const uniqueMsg = `journald-exe-${Date.now()}`;
            const log = {
                MESSAGE: uniqueMsg,
                _EXE: '/usr/bin/my-executable',
                PRIORITY: '7', // debug
            };

            await request(app.server)
                .post('/api/v1/ingest/single')
                .set('x-api-key', apiKey)
                .send(log)
                .expect(200);

            const dbLog = await db
                .selectFrom('logs')
                .selectAll()
                .where('message', '=', uniqueMsg)
                .executeTakeFirst();

            expect(dbLog?.service).toBe('my-executable');
            expect(dbLog?.level).toBe('debug');
        });

        it('should map journald PRIORITY levels correctly', async () => {
            const testCases = [
                { priority: '0', expectedLevel: 'critical' }, // emerg
                { priority: '1', expectedLevel: 'critical' }, // alert
                { priority: '2', expectedLevel: 'critical' }, // crit
                { priority: '3', expectedLevel: 'error' },    // err
                { priority: '4', expectedLevel: 'warn' },     // warning
                { priority: '5', expectedLevel: 'info' },     // notice
                { priority: '6', expectedLevel: 'info' },     // info
                { priority: '7', expectedLevel: 'debug' },    // debug
            ];

            for (const { priority, expectedLevel } of testCases) {
                const uniqueMsg = `journald-priority-${priority}-${Date.now()}-${Math.random()}`;
                const log = {
                    MESSAGE: uniqueMsg,
                    SYSLOG_IDENTIFIER: 'test-priority',
                    PRIORITY: priority,
                };

                await request(app.server)
                    .post('/api/v1/ingest/single')
                    .set('x-api-key', apiKey)
                    .send(log)
                    .expect(200);

                const dbLog = await db
                    .selectFrom('logs')
                    .selectAll()
                    .where('message', '=', uniqueMsg)
                    .executeTakeFirst();

                expect(dbLog?.level, `Priority ${priority} should map to ${expectedLevel}`).toBe(expectedLevel);
            }
        });

        it('should parse journald __REALTIME_TIMESTAMP correctly', async () => {
            const uniqueMsg = `journald-timestamp-${Date.now()}`;
            // Use a known timestamp (2024-01-01 12:00:00 UTC in microseconds)
            const timestampMicros = '1704110400000000';
            const log = {
                MESSAGE: uniqueMsg,
                SYSLOG_IDENTIFIER: 'timestamp-test',
                PRIORITY: '6',
                __REALTIME_TIMESTAMP: timestampMicros,
            };

            await request(app.server)
                .post('/api/v1/ingest/single')
                .set('x-api-key', apiKey)
                .send(log)
                .expect(200);

            const dbLog = await db
                .selectFrom('logs')
                .selectAll()
                .where('message', '=', uniqueMsg)
                .executeTakeFirst();

            expect(dbLog).toBeDefined();
            // Verify the timestamp was parsed from microseconds
            const logTime = new Date(dbLog!.time);
            expect(logTime.toISOString()).toBe('2024-01-01T12:00:00.000Z');
        });

        it('should extract journald metadata fields', async () => {
            const uniqueMsg = `journald-metadata-${Date.now()}`;
            const log = {
                MESSAGE: uniqueMsg,
                SYSLOG_IDENTIFIER: 'metadata-test',
                PRIORITY: '6',
                _HOSTNAME: 'server1',
                _PID: '12345',
                _UID: '1000',
                _GID: '1000',
                _MACHINE_ID: 'abc123',
                _BOOT_ID: 'xyz789',
                _CMDLINE: '/usr/bin/test --flag',
                _SYSTEMD_CGROUP: '/system.slice/test.service',
                _SYSTEMD_SLICE: 'system.slice',
                _TRANSPORT: 'journal',
                SYSLOG_FACILITY: '3',
            };

            await request(app.server)
                .post('/api/v1/ingest/single')
                .set('x-api-key', apiKey)
                .send(log)
                .expect(200);

            const dbLog = await db
                .selectFrom('logs')
                .selectAll()
                .where('message', '=', uniqueMsg)
                .executeTakeFirst();

            expect(dbLog?.metadata).toHaveProperty('_HOSTNAME', 'server1');
            expect(dbLog?.metadata).toHaveProperty('_PID', '12345');
            expect(dbLog?.metadata).toHaveProperty('_UID', '1000');
            expect(dbLog?.metadata).toHaveProperty('_MACHINE_ID', 'abc123');
            expect(dbLog?.metadata).toHaveProperty('_TRANSPORT', 'journal');
            expect(dbLog?.metadata).toHaveProperty('source', 'journald');
        });

        it('should fall back to level field when PRIORITY is not set for journald', async () => {
            const uniqueMsg = `journald-fallback-level-${Date.now()}`;
            const log = {
                MESSAGE: uniqueMsg,
                _SYSTEMD_UNIT: 'test.service',
                level: 'error', // Fallback level
                // No PRIORITY field
            };

            await request(app.server)
                .post('/api/v1/ingest/single')
                .set('x-api-key', apiKey)
                .send(log)
                .expect(200);

            const dbLog = await db
                .selectFrom('logs')
                .selectAll()
                .where('message', '=', uniqueMsg)
                .executeTakeFirst();

            expect(dbLog?.level).toBe('error');
        });

        it('should fall back to message field when MESSAGE is not set for journald', async () => {
            const uniqueMsg = `journald-fallback-message-${Date.now()}`;
            const log = {
                _SYSTEMD_UNIT: 'test.service',
                PRIORITY: '6',
                message: uniqueMsg, // Fallback to lowercase message
            };

            await request(app.server)
                .post('/api/v1/ingest/single')
                .set('x-api-key', apiKey)
                .send(log)
                .expect(200);

            const dbLog = await db
                .selectFrom('logs')
                .selectAll()
                .where('message', '=', uniqueMsg)
                .executeTakeFirst();

            expect(dbLog?.message).toBe(uniqueMsg);
        });

        it('should use _SOURCE_REALTIME_TIMESTAMP when __REALTIME_TIMESTAMP is not available', async () => {
            const uniqueMsg = `journald-source-timestamp-${Date.now()}`;
            const timestampMicros = '1704110400000000'; // 2024-01-01 12:00:00 UTC
            const log = {
                MESSAGE: uniqueMsg,
                SYSLOG_IDENTIFIER: 'timestamp-test',
                PRIORITY: '6',
                _SOURCE_REALTIME_TIMESTAMP: timestampMicros,
            };

            await request(app.server)
                .post('/api/v1/ingest/single')
                .set('x-api-key', apiKey)
                .send(log)
                .expect(200);

            const dbLog = await db
                .selectFrom('logs')
                .selectAll()
                .where('message', '=', uniqueMsg)
                .executeTakeFirst();

            const logTime = new Date(dbLog!.time);
            expect(logTime.toISOString()).toBe('2024-01-01T12:00:00.000Z');
        });

        it('should fall back to time field when journald timestamps are not available', async () => {
            const uniqueMsg = `journald-time-fallback-${Date.now()}`;
            const expectedTime = '2024-06-15T10:30:00.000Z';
            const log = {
                MESSAGE: uniqueMsg,
                _SYSTEMD_UNIT: 'test.service',
                PRIORITY: '6',
                time: expectedTime,
                // No __REALTIME_TIMESTAMP or _SOURCE_REALTIME_TIMESTAMP
            };

            await request(app.server)
                .post('/api/v1/ingest/single')
                .set('x-api-key', apiKey)
                .send(log)
                .expect(200);

            const dbLog = await db
                .selectFrom('logs')
                .selectAll()
                .where('message', '=', uniqueMsg)
                .executeTakeFirst();

            expect(new Date(dbLog!.time).toISOString()).toBe(expectedTime);
        });

        it('should use service field if provided even for journald format', async () => {
            const uniqueMsg = `journald-service-override-${Date.now()}`;
            const log = {
                MESSAGE: uniqueMsg,
                _SYSTEMD_UNIT: 'original.service',
                service: 'override-service', // Should take precedence
                PRIORITY: '6',
            };

            await request(app.server)
                .post('/api/v1/ingest/single')
                .set('x-api-key', apiKey)
                .send(log)
                .expect(200);

            const dbLog = await db
                .selectFrom('logs')
                .selectAll()
                .where('message', '=', uniqueMsg)
                .executeTakeFirst();

            expect(dbLog?.service).toBe('override-service');
        });

        it('should handle numeric PRIORITY value for journald', async () => {
            const uniqueMsg = `journald-numeric-priority-${Date.now()}`;
            const log = {
                MESSAGE: uniqueMsg,
                SYSLOG_IDENTIFIER: 'test',
                PRIORITY: 4, // Numeric instead of string
            };

            await request(app.server)
                .post('/api/v1/ingest/single')
                .set('x-api-key', apiKey)
                .send(log)
                .expect(200);

            const dbLog = await db
                .selectFrom('logs')
                .selectAll()
                .where('message', '=', uniqueMsg)
                .executeTakeFirst();

            expect(dbLog?.level).toBe('warn');
        });

        it('should handle undefined/null level gracefully', async () => {
            const uniqueMsg = `undefined-level-${Date.now()}`;
            const log = {
                time: new Date().toISOString(),
                service: 'test-undefined-level',
                level: undefined,
                message: uniqueMsg,
            };

            await request(app.server)
                .post('/api/v1/ingest/single')
                .set('x-api-key', apiKey)
                .send(log)
                .expect(200);

            const dbLog = await db
                .selectFrom('logs')
                .selectAll()
                .where('message', '=', uniqueMsg)
                .executeTakeFirst();

            expect(dbLog?.level).toBe('info'); // Default fallback
        });

        it('should fall back to log field for journald message', async () => {
            const uniqueMsg = `journald-log-fallback-${Date.now()}`;
            const log = {
                _SYSTEMD_UNIT: 'test.service',
                PRIORITY: '6',
                log: uniqueMsg, // Fallback to log field
            };

            await request(app.server)
                .post('/api/v1/ingest/single')
                .set('x-api-key', apiKey)
                .send(log)
                .expect(200);

            const dbLog = await db
                .selectFrom('logs')
                .selectAll()
                .where('message', '=', uniqueMsg)
                .executeTakeFirst();

            expect(dbLog?.message).toBe(uniqueMsg);
        });

        it('should return unknown service when no journald service identifiers are present', async () => {
            const uniqueMsg = `journald-unknown-service-${Date.now()}`;
            const log = {
                MESSAGE: uniqueMsg,
                PRIORITY: '6',
                // No SYSLOG_IDENTIFIER, _SYSTEMD_UNIT, _COMM, or _EXE
            };

            await request(app.server)
                .post('/api/v1/ingest/single')
                .set('x-api-key', apiKey)
                .send(log)
                .expect(200);

            const dbLog = await db
                .selectFrom('logs')
                .selectAll()
                .where('message', '=', uniqueMsg)
                .executeTakeFirst();

            expect(dbLog?.service).toBe('unknown');
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
