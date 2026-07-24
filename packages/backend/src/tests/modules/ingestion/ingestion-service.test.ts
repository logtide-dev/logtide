import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { ingestionService } from '../../../modules/ingestion/service.js';
import { createTestContext, createTestLog } from '../../helpers/factories.js';
import { piiMaskingService } from '../../../modules/pii-masking/service.js';
import { metering } from '../../../modules/metering/index.js';

/**
 * Tests for IngestionService to improve coverage
 */
describe('IngestionService', () => {
    let projectId: string;

    beforeEach(async () => {
        // Clean up (log_identifiers before logs due to FK)
        await db.deleteFrom('log_identifiers').execute();
        await db.deleteFrom('logs').execute();
        await db.deleteFrom('alert_history').execute();
        await db.deleteFrom('sigma_rules').execute();
        await db.deleteFrom('alert_rules').execute();
        await db.deleteFrom('api_keys').execute();
        await db.deleteFrom('notifications').execute();
        await db.deleteFrom('organization_members').execute();
        await db.deleteFrom('projects').execute();
        await db.deleteFrom('organizations').execute();
        await db.deleteFrom('sessions').execute();
        await db.deleteFrom('users').execute();

        const context = await createTestContext();
        projectId = context.project.id;
    });

    describe('ingestLogs', () => {
        it('should return 0 for empty logs array', async () => {
            const result = await ingestionService.ingestLogs([], projectId);
            expect(result.received).toBe(0);
        });

        it('should ingest logs and return count', async () => {
            const logs = [
                { time: new Date(), service: 'api', level: 'info' as const, message: 'Test 1' },
                { time: new Date(), service: 'api', level: 'error' as const, message: 'Test 2' },
            ];

            const result = await ingestionService.ingestLogs(logs, projectId);
            expect(result.received).toBe(2);
        });

        it('should sanitize null characters from strings', async () => {
            const logs = [
                {
                    time: new Date(),
                    service: 'test\u0000service',
                    level: 'info' as const,
                    message: 'Message with \u0000 null',
                    metadata: { key: 'value\u0000test' },
                },
            ];

            const result = await ingestionService.ingestLogs(logs, projectId);
            expect(result.received).toBe(1);

            // Verify sanitization
            const log = await db
                .selectFrom('logs')
                .selectAll()
                .where('project_id', '=', projectId)
                .executeTakeFirst();

            expect(log?.service).toBe('testservice');
            expect(log?.message).toBe('Message with  null');
        });

        it('should handle logs with trace_id and span_id', async () => {
            const logs = [
                {
                    time: new Date(),
                    service: 'api',
                    level: 'info' as const,
                    message: 'Test',
                    trace_id: '550e8400-e29b-41d4-a716-446655440000',
                    span_id: 'abc123def4567890',
                },
            ];

            const result = await ingestionService.ingestLogs(logs, projectId);
            expect(result.received).toBe(1);

            const log = await db
                .selectFrom('logs')
                .selectAll()
                .where('project_id', '=', projectId)
                .executeTakeFirst();

            expect(log?.trace_id).toBe('550e8400-e29b-41d4-a716-446655440000');
            expect(log?.span_id).toBe('abc123def4567890');
        });

        it('should handle string timestamps', async () => {
            const logs = [
                {
                    time: '2024-01-15T10:30:00.000Z',
                    service: 'api',
                    level: 'info' as const,
                    message: 'Test',
                },
            ];

            const result = await ingestionService.ingestLogs(logs, projectId);
            expect(result.received).toBe(1);

            const log = await db
                .selectFrom('logs')
                .selectAll()
                .where('project_id', '=', projectId)
                .executeTakeFirst();

            expect(log?.time).toBeInstanceOf(Date);
        });
    });

    describe('getStats', () => {
        it('should return stats grouped by level', async () => {
            // Create logs with different levels
            for (let i = 0; i < 5; i++) {
                await createTestLog({ projectId, level: 'info' });
            }
            for (let i = 0; i < 3; i++) {
                await createTestLog({ projectId, level: 'error' });
            }
            for (let i = 0; i < 2; i++) {
                await createTestLog({ projectId, level: 'debug' });
            }

            const stats = await ingestionService.getStats(projectId);

            expect(stats.total).toBe(10);
            expect(stats.by_level.info).toBe(5);
            expect(stats.by_level.error).toBe(3);
            expect(stats.by_level.debug).toBe(2);
        });

        it('should filter by from date', async () => {
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
            const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

            await db.insertInto('logs').values({
                project_id: projectId, service: 'test', level: 'info',
                message: 'Old log', time: twoHoursAgo,
            }).execute();
            await db.insertInto('logs').values({
                project_id: projectId, service: 'test', level: 'info',
                message: 'Recent log', time: now,
            }).execute();

            const stats = await ingestionService.getStats(projectId, oneHourAgo);

            expect(stats.total).toBe(1);
            expect(stats.by_level.info).toBe(1);
        });

        it('should filter by to date', async () => {
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
            const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

            await db.insertInto('logs').values({
                project_id: projectId, service: 'test', level: 'info',
                message: 'Old log', time: twoHoursAgo,
            }).execute();
            await db.insertInto('logs').values({
                project_id: projectId, service: 'test', level: 'info',
                message: 'Recent log', time: now,
            }).execute();

            const stats = await ingestionService.getStats(projectId, undefined, oneHourAgo);

            expect(stats.total).toBe(1);
            expect(stats.by_level.info).toBe(1);
        });

        it('should filter by both from and to dates', async () => {
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
            const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
            const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

            await db.insertInto('logs').values({
                project_id: projectId, service: 'test', level: 'info',
                message: 'Too old', time: threeHoursAgo,
            }).execute();
            await db.insertInto('logs').values({
                project_id: projectId, service: 'test', level: 'error',
                message: 'In window', time: twoHoursAgo,
            }).execute();
            await db.insertInto('logs').values({
                project_id: projectId, service: 'test', level: 'info',
                message: 'Too new', time: now,
            }).execute();

            const stats = await ingestionService.getStats(projectId, new Date(twoHoursAgo.getTime() - 1000), oneHourAgo);

            expect(stats.total).toBe(1);
            expect(stats.by_level.error).toBe(1);
        });

        it('should return empty stats for project with no logs', async () => {
            const stats = await ingestionService.getStats(projectId);

            expect(stats.total).toBe(0);
            expect(stats.by_level).toEqual({});
        });

        it('should handle all log levels', async () => {
            await createTestLog({ projectId, level: 'debug' });
            await createTestLog({ projectId, level: 'info' });
            await createTestLog({ projectId, level: 'warn' });
            await createTestLog({ projectId, level: 'error' });
            await createTestLog({ projectId, level: 'critical' });

            const stats = await ingestionService.getStats(projectId);

            expect(stats.total).toBe(5);
            expect(stats.by_level.debug).toBe(1);
            expect(stats.by_level.info).toBe(1);
            expect(stats.by_level.warn).toBe(1);
            expect(stats.by_level.error).toBe(1);
            expect(stats.by_level.critical).toBe(1);
        });

        it('should correctly count logs within time range', async () => {
            const now = new Date();
            const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
            const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

            // Log at 3 hours ago (outside range)
            await db.insertInto('logs').values({
                project_id: projectId,
                service: 'test',
                level: 'info',
                message: 'Old',
                time: threeHoursAgo,
            }).execute();

            // Log at 1.5 hours ago (inside range)
            await db.insertInto('logs').values({
                project_id: projectId,
                service: 'test',
                level: 'error',
                message: 'Inside range',
                time: new Date(now.getTime() - 90 * 60 * 1000),
            }).execute();

            // Log now (inside range)
            await db.insertInto('logs').values({
                project_id: projectId,
                service: 'test',
                level: 'warn',
                message: 'Recent',
                time: now,
            }).execute();

            const stats = await ingestionService.getStats(projectId, twoHoursAgo, now);

            // Should only include logs from last 2 hours
            expect(stats.total).toBe(2);
            expect(stats.by_level.error).toBe(1);
            expect(stats.by_level.warn).toBe(1);
            expect(stats.by_level.info).toBeUndefined();
        });
    });

    describe('ingestLogs - advanced scenarios', () => {
        it('should trigger exception parsing for error logs', async () => {
            const logs = [
                {
                    time: new Date(),
                    service: 'api',
                    level: 'error' as const,
                    message: 'Error: Something failed\n    at handler (/app/src/handler.ts:10:5)',
                },
            ];

            const result = await ingestionService.ingestLogs(logs, projectId);
            expect(result.received).toBe(1);

            // Verify log was inserted
            const log = await db
                .selectFrom('logs')
                .selectAll()
                .where('project_id', '=', projectId)
                .executeTakeFirst();

            expect(log?.level).toBe('error');
        });

        it('should trigger exception parsing for critical logs', async () => {
            const logs = [
                {
                    time: new Date(),
                    service: 'api',
                    level: 'critical' as const,
                    message: 'CRITICAL: System crash',
                },
            ];

            const result = await ingestionService.ingestLogs(logs, projectId);
            expect(result.received).toBe(1);
        });

        it('should sanitize null chars in arrays within metadata', async () => {
            const logs = [
                {
                    time: new Date(),
                    service: 'api',
                    level: 'info' as const,
                    message: 'Test',
                    metadata: {
                        tags: ['tag\u0000one', 'tag\u0000two'],
                        nested: { value: 'test\u0000value' },
                    },
                },
            ];

            const result = await ingestionService.ingestLogs(logs, projectId);
            expect(result.received).toBe(1);

            const log = await db
                .selectFrom('logs')
                .selectAll()
                .where('project_id', '=', projectId)
                .executeTakeFirst();

            const metadata = log?.metadata as { tags?: string[]; nested?: { value: string } };
            expect(metadata?.tags?.[0]).toBe('tagone');
            expect(metadata?.tags?.[1]).toBe('tagtwo');
            expect(metadata?.nested?.value).toBe('testvalue');
        });

        it('should handle logs with various metadata types', async () => {
            const logs = [
                {
                    time: new Date(),
                    service: 'api',
                    level: 'info' as const,
                    message: 'Test',
                    metadata: {
                        stringVal: 'test',
                        numberVal: 123,
                        boolVal: true,
                        nullVal: null,
                        arrayVal: [1, 2, 3],
                        objectVal: { nested: true },
                    },
                },
            ];

            const result = await ingestionService.ingestLogs(logs, projectId);
            expect(result.received).toBe(1);
        });

        it('should handle logs without metadata', async () => {
            const logs = [
                {
                    time: new Date(),
                    service: 'api',
                    level: 'info' as const,
                    message: 'No metadata',
                },
            ];

            const result = await ingestionService.ingestLogs(logs, projectId);
            expect(result.received).toBe(1);

            const log = await db
                .selectFrom('logs')
                .selectAll()
                .where('project_id', '=', projectId)
                .executeTakeFirst();

            expect(log?.metadata).toBeNull();
        });

        it('should handle logs without trace_id', async () => {
            const logs = [
                {
                    time: new Date(),
                    service: 'api',
                    level: 'info' as const,
                    message: 'No trace',
                },
            ];

            const result = await ingestionService.ingestLogs(logs, projectId);
            expect(result.received).toBe(1);

            const log = await db
                .selectFrom('logs')
                .selectAll()
                .where('project_id', '=', projectId)
                .executeTakeFirst();

            expect(log?.trace_id).toBeNull();
        });

        it('should handle large batch of logs', async () => {
            const logs = Array.from({ length: 100 }, (_, i) => ({
                time: new Date(),
                service: `service-${i % 5}`,
                level: (['debug', 'info', 'warn', 'error', 'critical'] as const)[i % 5],
                message: `Log message ${i}`,
            }));

            const result = await ingestionService.ingestLogs(logs, projectId);
            expect(result.received).toBe(100);

            const stats = await ingestionService.getStats(projectId);
            expect(stats.total).toBe(100);
        });
    });

    describe('PII masking fail-closed', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('rejects records whose masking failed and stores the rest', async () => {
            vi.spyOn(piiMaskingService, 'maskLogBatch').mockResolvedValue([1]);
            const recordSpy = vi.spyOn(metering, 'record').mockImplementation(() => {});

            const logs = [
                { time: new Date(), service: 'svc', level: 'info' as const, message: 'keep me 0' },
                { time: new Date(), service: 'svc', level: 'info' as const, message: 'reject me' },
                { time: new Date(), service: 'svc', level: 'info' as const, message: 'keep me 2' },
            ];

            const result = await ingestionService.ingestLogs(logs, projectId);

            expect(result.received).toBe(2);
            expect(result.rejected).toEqual([{ index: 1, reason: 'pii_masking_failed' }]);

            const stats = await ingestionService.getStats(projectId);
            expect(stats.total).toBe(2);

            expect(recordSpy).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'ingestion.pii_rejected', quantity: 1 })
            );
        });

        it('rejects the whole batch when every record fails masking', async () => {
            vi.spyOn(piiMaskingService, 'maskLogBatch').mockResolvedValue([0, 1]);
            vi.spyOn(metering, 'record').mockImplementation(() => {});

            const logs = [
                { time: new Date(), service: 'svc', level: 'info' as const, message: 'a' },
                { time: new Date(), service: 'svc', level: 'info' as const, message: 'b' },
            ];

            const result = await ingestionService.ingestLogs(logs, projectId);

            expect(result.received).toBe(0);
            expect(result.rejected).toHaveLength(2);

            const stats = await ingestionService.getStats(projectId);
            expect(stats.total).toBe(0);
        });

        it('returns empty rejected array on the happy path', async () => {
            const logs = [{ time: new Date(), service: 'svc', level: 'info' as const, message: 'ok' }];
            const result = await ingestionService.ingestLogs(logs, projectId);
            expect(result.received).toBe(1);
            expect(result.rejected).toEqual([]);
        });
    });

    describe('clock skew detection (#279)', () => {
        it('records a skew counter and still stores the log', async () => {
            const recordSpy = vi.spyOn(metering, 'record');

            const skewed = new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString();
            const result = await ingestionService.ingestLogs(
                [{ time: skewed, service: 'ubuntu', level: 'critical', message: 'skewed log' }],
                projectId,
            );

            // The invariant that matters: skew never rejects.
            expect(result.received).toBe(1);
            expect(result.rejected).toEqual([]);

            const skewCall = recordSpy.mock.calls.find(
                ([e]) => e.type === 'ingestion.timestamp_skew',
            );
            expect(skewCall).toBeDefined();
            expect(skewCall![0].quantity).toBe(1);
            expect(skewCall![0].projectId).toBe(projectId);
            expect(skewCall![0].metadata).toMatchObject({ maxFutureMs: 0 });
            expect((skewCall![0].metadata as { maxPastMs: number }).maxPastMs).toBeGreaterThan(
                24 * 60 * 60 * 1000,
            );

            recordSpy.mockRestore();
        });

        it('records no skew counter for a fresh log', async () => {
            const recordSpy = vi.spyOn(metering, 'record');

            await ingestionService.ingestLogs(
                [{ time: new Date().toISOString(), service: 'ubuntu', level: 'info', message: 'fresh' }],
                projectId,
            );

            expect(
                recordSpy.mock.calls.find(([e]) => e.type === 'ingestion.timestamp_skew'),
            ).toBeUndefined();

            recordSpy.mockRestore();
        });

        it('counts only the skewed records in a mixed batch', async () => {
            const recordSpy = vi.spyOn(metering, 'record');

            await ingestionService.ingestLogs(
                [
                    { time: new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString(), service: 'a', level: 'info', message: 'old' },
                    { time: new Date().toISOString(), service: 'a', level: 'info', message: 'fresh' },
                    { time: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(), service: 'a', level: 'info', message: 'older' },
                ],
                projectId,
            );

            const skewCall = recordSpy.mock.calls.find(
                ([e]) => e.type === 'ingestion.timestamp_skew',
            );
            expect(skewCall![0].quantity).toBe(2);

            recordSpy.mockRestore();
        });
    });
});
