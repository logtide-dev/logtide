import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { queryService } from '../../../modules/query/service.js';
import { createTestContext, createTestLog } from '../../helpers/factories.js';

/**
 * Tests for QueryService to improve coverage
 */
describe('QueryService', () => {
    let projectId: string;
    let organizationId: string;

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
        organizationId = context.organization.id;
    });

    describe('queryLogs', () => {
        it('should return cached results on subsequent calls', async () => {
            await createTestLog({ projectId, service: 'api', level: 'info' });
            await createTestLog({ projectId, service: 'api', level: 'error' });

            // First call - cache miss
            const result1 = await queryService.queryLogs({ projectId });

            // Second call with same params - should hit cache
            const result2 = await queryService.queryLogs({ projectId });

            expect(result1.logs.length).toBe(result2.logs.length);
        });

        it('should handle multiple project IDs', async () => {
            const context2 = await createTestContext();

            await createTestLog({ projectId, service: 'api', level: 'info' });
            await createTestLog({ projectId: context2.project.id, service: 'worker', level: 'error' });

            const result = await queryService.queryLogs({
                projectId: [projectId, context2.project.id],
            });

            expect(result.logs.length).toBe(2);
        });

        it('should handle multiple service filters', async () => {
            await createTestLog({ projectId, service: 'api', level: 'info' });
            await createTestLog({ projectId, service: 'worker', level: 'info' });
            await createTestLog({ projectId, service: 'scheduler', level: 'info' });

            const result = await queryService.queryLogs({
                projectId,
                service: ['api', 'worker'],
            });

            expect(result.logs.length).toBe(2);
            result.logs.forEach(log => {
                expect(['api', 'worker']).toContain(log.service);
            });
        });

        it('should handle multiple level filters', async () => {
            await createTestLog({ projectId, level: 'debug' });
            await createTestLog({ projectId, level: 'info' });
            await createTestLog({ projectId, level: 'error' });

            const result = await queryService.queryLogs({
                projectId,
                level: ['debug', 'info'],
            });

            expect(result.logs.length).toBe(2);
            result.logs.forEach(log => {
                expect(['debug', 'info']).toContain(log.level);
            });
        });

        it('should handle hostname filter from metadata', async () => {
            await db.insertInto('logs').values({
                project_id: projectId,
                service: 'api',
                level: 'info',
                message: 'Test',
                time: new Date(),
                metadata: { hostname: 'server1.example.com' },
            }).execute();

            await db.insertInto('logs').values({
                project_id: projectId,
                service: 'api',
                level: 'info',
                message: 'Test 2',
                time: new Date(),
                metadata: { hostname: 'server2.example.com' },
            }).execute();

            const result = await queryService.queryLogs({
                projectId,
                hostname: 'server1.example.com',
            });

            expect(result.logs.length).toBe(1);
            expect((result.logs[0].metadata as any).hostname).toBe('server1.example.com');
        });

        it('should handle multiple hostname filters', async () => {
            await db.insertInto('logs').values({
                project_id: projectId,
                service: 'api',
                level: 'info',
                message: 'Test 1',
                time: new Date(),
                metadata: { hostname: 'server1.example.com' },
            }).execute();

            await db.insertInto('logs').values({
                project_id: projectId,
                service: 'api',
                level: 'info',
                message: 'Test 2',
                time: new Date(),
                metadata: { hostname: 'server2.example.com' },
            }).execute();

            await db.insertInto('logs').values({
                project_id: projectId,
                service: 'api',
                level: 'info',
                message: 'Test 3',
                time: new Date(),
                metadata: { hostname: 'server3.example.com' },
            }).execute();

            const result = await queryService.queryLogs({
                projectId,
                hostname: ['server1.example.com', 'server2.example.com'],
            });

            expect(result.logs.length).toBe(2);
        });

        it('should handle cursor pagination correctly', async () => {
            // Create 15 logs
            for (let i = 0; i < 15; i++) {
                await createTestLog({ projectId, message: `Log ${i}` });
            }

            // Get first page
            const page1 = await queryService.queryLogs({
                projectId,
                limit: 5,
            });

            expect(page1.logs.length).toBe(5);
            expect(page1.nextCursor).toBeDefined();

            // Get second page using cursor
            const page2 = await queryService.queryLogs({
                projectId,
                limit: 5,
                cursor: page1.nextCursor,
            });

            expect(page2.logs.length).toBe(5);
            // IDs should be different
            const page1Ids = page1.logs.map(l => l.id);
            const page2Ids = page2.logs.map(l => l.id);
            expect(page1Ids.every(id => !page2Ids.includes(id))).toBe(true);
        });

        it('should handle invalid cursor gracefully', async () => {
            await createTestLog({ projectId });

            // Should not throw with invalid cursor
            const result = await queryService.queryLogs({
                projectId,
                cursor: 'invalid-base64-cursor',
            });

            expect(result.logs.length).toBeGreaterThanOrEqual(0);
        });

        it('should handle substring search mode', async () => {
            await createTestLog({ projectId, message: 'spa.bluez5.native connected' });
            await createTestLog({ projectId, message: 'normal log message' });

            const result = await queryService.queryLogs({
                projectId,
                q: 'bluez',
                searchMode: 'substring',
            });

            expect(result.logs.length).toBe(1);
            expect(result.logs[0].message).toContain('bluez');
        });

        it('should escape LIKE characters in substring search', async () => {
            await createTestLog({ projectId, message: 'Progress: 100% complete' });
            await createTestLog({ projectId, message: 'Progress: 50% complete' });

            const result = await queryService.queryLogs({
                projectId,
                q: '100%',
                searchMode: 'substring',
            });

            expect(result.logs.length).toBe(1);
            expect(result.logs[0].message).toContain('100%');
        });
    });

    describe('getLogById', () => {
        it('should return null for non-existent log', async () => {
            const result = await queryService.getLogById(
                '00000000-0000-0000-0000-000000000000',
                projectId
            );

            expect(result).toBeNull();
        });

        it('should return log with correct fields', async () => {
            const log = await createTestLog({
                projectId,
                service: 'api',
                level: 'error',
                message: 'Test error',
            });

            const result = await queryService.getLogById(log.id, projectId);

            expect(result).not.toBeNull();
            expect(result?.id).toBe(log.id);
            expect(result?.service).toBe('api');
            expect(result?.level).toBe('error');
            expect(result?.message).toBe('Test error');
            expect(result?.projectId).toBe(projectId);
        });
    });

    describe('getLogsByTraceId', () => {
        it('should return logs with matching trace ID', async () => {
            const traceId = '550e8400-e29b-41d4-a716-446655440000';

            await createTestLog({ projectId, trace_id: traceId, message: 'Request start' });
            await createTestLog({ projectId, trace_id: traceId, message: 'Request end' });
            await createTestLog({ projectId, trace_id: 'other-trace-id', message: 'Other request' });

            const result = await queryService.getLogsByTraceId(projectId, traceId);

            expect(result.length).toBe(2);
            result.forEach(log => {
                expect(log.traceId).toBe(traceId);
            });
        });

        it('should return cached trace results', async () => {
            const traceId = '550e8400-e29b-41d4-a716-446655440001';

            await createTestLog({ projectId, trace_id: traceId });

            // First call
            const result1 = await queryService.getLogsByTraceId(projectId, traceId);
            // Second call should hit cache
            const result2 = await queryService.getLogsByTraceId(projectId, traceId);

            expect(result1.length).toBe(result2.length);
        });
    });

    describe('getLogContext', () => {
        it('should return logs before and after specified time', async () => {
            const centerTime = new Date();

            // Create logs before
            for (let i = 5; i >= 1; i--) {
                await db.insertInto('logs').values({
                    project_id: projectId,
                    service: 'test',
                    level: 'info',
                    message: `Before ${i}`,
                    time: new Date(centerTime.getTime() - i * 1000),
                }).execute();
            }

            // Create logs after
            for (let i = 1; i <= 5; i++) {
                await db.insertInto('logs').values({
                    project_id: projectId,
                    service: 'test',
                    level: 'info',
                    message: `After ${i}`,
                    time: new Date(centerTime.getTime() + i * 1000),
                }).execute();
            }

            const context = await queryService.getLogContext({
                projectId,
                time: centerTime,
                before: 3,
                after: 3,
            });

            expect(context.before.length).toBeLessThanOrEqual(3);
            expect(context.after.length).toBeLessThanOrEqual(3);
        });

        it('should return current log if exists at exact time', async () => {
            const exactTime = new Date();

            await db.insertInto('logs').values({
                project_id: projectId,
                service: 'test',
                level: 'info',
                message: 'Exact time log',
                time: exactTime,
            }).execute();

            const context = await queryService.getLogContext({
                projectId,
                time: exactTime,
            });

            expect(context.current).not.toBeNull();
            expect(context.current?.message).toBe('Exact time log');
        });
    });

    describe('getAggregatedStats', () => {
        it('should return aggregated stats by time bucket', async () => {
            const now = new Date();

            for (let i = 0; i < 5; i++) {
                await createTestLog({ projectId, level: 'info' });
            }
            for (let i = 0; i < 3; i++) {
                await createTestLog({ projectId, level: 'error' });
            }

            const result = await queryService.getAggregatedStats({
                projectId,
                from: new Date(now.getTime() - 60 * 60 * 1000),
                to: new Date(now.getTime() + 60 * 1000),
                interval: '1h',
            });

            expect(result.timeseries).toBeDefined();
            expect(Array.isArray(result.timeseries)).toBe(true);
        });

        it('should filter by service', async () => {
            await createTestLog({ projectId, service: 'api', level: 'info' });
            await createTestLog({ projectId, service: 'worker', level: 'info' });

            const now = new Date();
            const result = await queryService.getAggregatedStats({
                projectId,
                service: 'api',
                from: new Date(now.getTime() - 60 * 60 * 1000),
                to: new Date(now.getTime() + 60 * 1000),
                interval: '1h',
            });

            expect(result.timeseries).toBeDefined();
        });
    });

    describe('getTopServices', () => {
        it('should return top services with count', async () => {
            for (let i = 0; i < 10; i++) {
                await createTestLog({ projectId, service: 'api' });
            }
            for (let i = 0; i < 5; i++) {
                await createTestLog({ projectId, service: 'worker' });
            }

            const result = await queryService.getTopServices(projectId, 5);

            expect(result.length).toBe(2);
            expect(result[0].service).toBe('api');
            expect(Number(result[0].count)).toBe(10);
        });

        it('should filter by time range', async () => {
            const now = new Date();
            const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

            // Use an explicit time safely inside [yesterday, now] so the log
            // can't land just past the upper bound due to insert timing
            await createTestLog({
                projectId,
                service: 'api',
                time: new Date(now.getTime() - 60 * 1000),
            });

            const result = await queryService.getTopServices(
                projectId,
                5,
                yesterday,
                now
            );

            expect(result.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('getDistinctServices', () => {
        it('should return distinct services', async () => {
            await createTestLog({ projectId, service: 'api' });
            await createTestLog({ projectId, service: 'api' });
            await createTestLog({ projectId, service: 'worker' });
            await createTestLog({ projectId, service: 'scheduler' });

            const result = await queryService.getDistinctServices(projectId);

            expect(result.length).toBe(3);
            expect(result).toContain('api');
            expect(result).toContain('worker');
            expect(result).toContain('scheduler');
        });

        it('should handle multiple project IDs', async () => {
            const context2 = await createTestContext();

            await createTestLog({ projectId, service: 'api' });
            await createTestLog({ projectId: context2.project.id, service: 'worker' });

            const result = await queryService.getDistinctServices([projectId, context2.project.id]);

            expect(result).toContain('api');
            expect(result).toContain('worker');
        });

        it('should filter by time range', async () => {
            await createTestLog({ projectId, service: 'api' });

            const now = new Date();
            const result = await queryService.getDistinctServices(
                projectId,
                new Date(now.getTime() - 24 * 60 * 60 * 1000),
                now
            );

            expect(result.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('getDistinctHostnames', () => {
        it('should return distinct hostnames from metadata', async () => {
            await db.insertInto('logs').values({
                project_id: projectId,
                service: 'api',
                level: 'info',
                message: 'Test',
                time: new Date(),
                metadata: { hostname: 'server1.example.com' },
            }).execute();

            await db.insertInto('logs').values({
                project_id: projectId,
                service: 'api',
                level: 'info',
                message: 'Test',
                time: new Date(),
                metadata: { hostname: 'server2.example.com' },
            }).execute();

            const result = await queryService.getDistinctHostnames(projectId);

            expect(result.length).toBe(2);
            expect(result).toContain('server1.example.com');
            expect(result).toContain('server2.example.com');
        });

        it('should handle multiple project IDs', async () => {
            const context2 = await createTestContext();

            await db.insertInto('logs').values({
                project_id: projectId,
                service: 'api',
                level: 'info',
                message: 'Test',
                time: new Date(),
                metadata: { hostname: 'server1.example.com' },
            }).execute();

            await db.insertInto('logs').values({
                project_id: context2.project.id,
                service: 'api',
                level: 'info',
                message: 'Test',
                time: new Date(),
                metadata: { hostname: 'server2.example.com' },
            }).execute();

            const result = await queryService.getDistinctHostnames([projectId, context2.project.id]);

            expect(result).toContain('server1.example.com');
            expect(result).toContain('server2.example.com');
        });

        it('should include hosts that only logged 6-24h ago (not clamped to 6h)', async () => {
            // Regression for #273: the lookup window was clamped to 6h, so a host that
            // last logged 10h ago was missing from the dropdown while its logs stayed
            // visible in the (24h) logs view.
            const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000);

            await db.insertInto('logs').values({
                project_id: projectId,
                service: 'api',
                level: 'info',
                message: 'Test',
                time: tenHoursAgo,
                metadata: { hostname: 'old-host.example.com' },
            }).execute();

            const result = await queryService.getDistinctHostnames(projectId);

            expect(result).toContain('old-host.example.com');
        });
    });

    describe('getTopErrors', () => {
        it('should return top error messages', async () => {
            for (let i = 0; i < 5; i++) {
                await createTestLog({ projectId, level: 'error', message: 'Database timeout' });
            }
            for (let i = 0; i < 3; i++) {
                await createTestLog({ projectId, level: 'error', message: 'Auth failed' });
            }
            for (let i = 0; i < 2; i++) {
                await createTestLog({ projectId, level: 'critical', message: 'System crash' });
            }

            const result = await queryService.getTopErrors(projectId, 10);

            expect(result.length).toBe(3);
            expect(result[0].message).toBe('Database timeout');
            expect(Number(result[0].count)).toBe(5);
        });

        it('should filter by time range', async () => {
            await createTestLog({ projectId, level: 'error', message: 'Test error' });

            const now = new Date();
            const result = await queryService.getTopErrors(
                projectId,
                10,
                new Date(now.getTime() - 24 * 60 * 60 * 1000),
                now
            );

            expect(result.length).toBeGreaterThanOrEqual(1);
        });

        it('should exclude info/debug/warn logs', async () => {
            await createTestLog({ projectId, level: 'info', message: 'Info message' });
            await createTestLog({ projectId, level: 'debug', message: 'Debug message' });
            await createTestLog({ projectId, level: 'warn', message: 'Warn message' });
            await createTestLog({ projectId, level: 'error', message: 'Error message' });

            const result = await queryService.getTopErrors(projectId, 10);

            expect(result.length).toBe(1);
            expect(result[0].message).toBe('Error message');
        });
    });
});
