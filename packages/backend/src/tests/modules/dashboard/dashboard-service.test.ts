import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { dashboardService } from '../../../modules/dashboard/service.js';
import { createTestContext, createTestLog } from '../../helpers/factories.js';

describe('DashboardService', () => {
    beforeEach(async () => {
        // Clean up in correct order (respecting foreign keys)
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
    });

    describe('getStats', () => {
        it('should return zeros for organization with no projects', async () => {
            const { organization } = await createTestContext();

            // Delete all projects to test empty state
            await db.deleteFrom('api_keys').execute();
            await db.deleteFrom('projects').execute();

            const stats = await dashboardService.getStats(organization.id);

            expect(stats.totalLogsToday.value).toBe(0);
            expect(stats.totalLogsToday.trend).toBe(0);
            expect(stats.errorRate.value).toBe(0);
            expect(stats.errorRate.trend).toBe(0);
            expect(stats.activeServices.value).toBe(0);
            expect(stats.activeServices.trend).toBe(0);
            expect(stats.avgThroughput.value).toBe(0);
            expect(stats.avgThroughput.trend).toBe(0);
        });

        it('should return zeros for organization with no logs', async () => {
            const { organization } = await createTestContext();

            const stats = await dashboardService.getStats(organization.id);

            expect(stats.totalLogsToday.value).toBe(0);
            expect(stats.activeServices.value).toBe(0);
        });

        it('should count logs from today', async () => {
            const { organization, project } = await createTestContext();

            // Create logs for today
            await createTestLog({ projectId: project.id, service: 'api', level: 'info' });
            await createTestLog({ projectId: project.id, service: 'api', level: 'info' });
            await createTestLog({ projectId: project.id, service: 'worker', level: 'debug' });

            const stats = await dashboardService.getStats(organization.id);

            expect(stats.totalLogsToday.value).toBe(3);
        });

        it('should calculate error rate correctly', async () => {
            const { organization, project } = await createTestContext();

            // Create 8 info logs and 2 error logs = 20% error rate
            for (let i = 0; i < 8; i++) {
                await createTestLog({ projectId: project.id, level: 'info' });
            }
            await createTestLog({ projectId: project.id, level: 'error' });
            await createTestLog({ projectId: project.id, level: 'critical' });

            const stats = await dashboardService.getStats(organization.id);

            expect(stats.errorRate.value).toBe(20); // 2/10 = 20%
        });

        it('should count distinct active services', async () => {
            const { organization, project } = await createTestContext();

            await createTestLog({ projectId: project.id, service: 'api' });
            await createTestLog({ projectId: project.id, service: 'api' });
            await createTestLog({ projectId: project.id, service: 'worker' });
            await createTestLog({ projectId: project.id, service: 'scheduler' });

            const stats = await dashboardService.getStats(organization.id);

            expect(stats.activeServices.value).toBe(3); // api, worker, scheduler
        });

        it('should not include logs from other organizations', async () => {
            const { organization: org1, project: project1 } = await createTestContext();
            const { organization: org2, project: project2 } = await createTestContext();

            // Create logs for org1
            await createTestLog({ projectId: project1.id });
            await createTestLog({ projectId: project1.id });

            // Create logs for org2
            await createTestLog({ projectId: project2.id });

            const stats1 = await dashboardService.getStats(org1.id);
            const stats2 = await dashboardService.getStats(org2.id);

            expect(stats1.totalLogsToday.value).toBe(2);
            expect(stats2.totalLogsToday.value).toBe(1);
        });
    });

    describe('getTimeseries', () => {
        it('should return empty array for organization with no projects', async () => {
            const { organization } = await createTestContext();

            await db.deleteFrom('api_keys').execute();
            await db.deleteFrom('projects').execute();

            const timeseries = await dashboardService.getTimeseries(organization.id);

            expect(timeseries).toEqual([]);
        });

        it('should return empty array for organization with no logs', async () => {
            const { organization } = await createTestContext();

            const timeseries = await dashboardService.getTimeseries(organization.id);

            expect(timeseries).toEqual([]);
        });

        it('should return timeseries data points', async () => {
            const { organization, project } = await createTestContext();

            // Create some logs
            await createTestLog({ projectId: project.id, level: 'info' });
            await createTestLog({ projectId: project.id, level: 'error' });
            await createTestLog({ projectId: project.id, level: 'debug' });

            const timeseries = await dashboardService.getTimeseries(organization.id);

            expect(timeseries.length).toBeGreaterThan(0);

            // Check structure of data point
            const point = timeseries[0];
            expect(point).toHaveProperty('time');
            expect(point).toHaveProperty('total');
            expect(point).toHaveProperty('debug');
            expect(point).toHaveProperty('info');
            expect(point).toHaveProperty('warn');
            expect(point).toHaveProperty('error');
            expect(point).toHaveProperty('critical');
        });

        it('should aggregate logs by level', async () => {
            const { organization, project } = await createTestContext();

            // Create logs with different levels
            await createTestLog({ projectId: project.id, level: 'info' });
            await createTestLog({ projectId: project.id, level: 'info' });
            await createTestLog({ projectId: project.id, level: 'error' });

            const timeseries = await dashboardService.getTimeseries(organization.id);

            // Find the data point (should be one since all logs are in same hour)
            expect(timeseries.length).toBe(1);
            const point = timeseries[0];
            expect(point.total).toBe(3);
            expect(point.info).toBe(2);
            expect(point.error).toBe(1);
        });
    });

    describe('getTopServices', () => {
        it('should return empty array for organization with no projects', async () => {
            const { organization } = await createTestContext();

            await db.deleteFrom('api_keys').execute();
            await db.deleteFrom('projects').execute();

            const services = await dashboardService.getTopServices(organization.id);

            expect(services).toEqual([]);
        });

        it('should return empty array for organization with no logs', async () => {
            const { organization } = await createTestContext();

            const services = await dashboardService.getTopServices(organization.id);

            expect(services).toEqual([]);
        });

        it('should return top services by log count', async () => {
            const { organization, project } = await createTestContext();

            // Create logs: api (5), worker (3), scheduler (2)
            for (let i = 0; i < 5; i++) {
                await createTestLog({ projectId: project.id, service: 'api' });
            }
            for (let i = 0; i < 3; i++) {
                await createTestLog({ projectId: project.id, service: 'worker' });
            }
            for (let i = 0; i < 2; i++) {
                await createTestLog({ projectId: project.id, service: 'scheduler' });
            }

            const services = await dashboardService.getTopServices(organization.id);

            expect(services).toHaveLength(3);
            expect(services[0].name).toBe('api');
            expect(services[0].count).toBe(5);
            expect(services[1].name).toBe('worker');
            expect(services[1].count).toBe(3);
            expect(services[2].name).toBe('scheduler');
            expect(services[2].count).toBe(2);
        });

        it('should calculate percentages correctly', async () => {
            const { organization, project } = await createTestContext();

            // Create 10 logs total
            for (let i = 0; i < 5; i++) {
                await createTestLog({ projectId: project.id, service: 'api' });
            }
            for (let i = 0; i < 5; i++) {
                await createTestLog({ projectId: project.id, service: 'worker' });
            }

            const services = await dashboardService.getTopServices(organization.id);

            expect(services[0].percentage).toBe(50);
            expect(services[1].percentage).toBe(50);
        });

        it('should respect limit parameter', async () => {
            const { organization, project } = await createTestContext();

            // Create logs for 5 services
            const serviceNames = ['a', 'b', 'c', 'd', 'e'];
            for (const name of serviceNames) {
                await createTestLog({ projectId: project.id, service: name });
            }

            const services = await dashboardService.getTopServices(organization.id, 3);

            expect(services).toHaveLength(3);
        });

        it('should default to 5 services', async () => {
            const { organization, project } = await createTestContext();

            // Create logs for 10 services
            for (let i = 0; i < 10; i++) {
                await createTestLog({ projectId: project.id, service: `service-${i}` });
            }

            const services = await dashboardService.getTopServices(organization.id);

            expect(services).toHaveLength(5);
        });
    });

    describe('getRecentErrors', () => {
        it('should return empty array for organization with no projects', async () => {
            const { organization } = await createTestContext();

            await db.deleteFrom('api_keys').execute();
            await db.deleteFrom('projects').execute();

            const errors = await dashboardService.getRecentErrors(organization.id);

            expect(errors).toEqual([]);
        });

        it('should return empty array when no errors exist', async () => {
            const { organization, project } = await createTestContext();

            // Create only info logs
            await createTestLog({ projectId: project.id, level: 'info' });
            await createTestLog({ projectId: project.id, level: 'debug' });

            const errors = await dashboardService.getRecentErrors(organization.id);

            expect(errors).toEqual([]);
        });

        it('should return error and critical logs', async () => {
            const { organization, project } = await createTestContext();

            await createTestLog({ projectId: project.id, level: 'info' });
            await createTestLog({ projectId: project.id, level: 'error', message: 'Error 1' });
            await createTestLog({ projectId: project.id, level: 'critical', message: 'Critical 1' });

            const errors = await dashboardService.getRecentErrors(organization.id);

            expect(errors).toHaveLength(2);
            expect(errors.every((e) => ['error', 'critical'].includes(e.level))).toBe(true);
        });

        it('should return correct error structure', async () => {
            const { organization, project } = await createTestContext();

            await createTestLog({
                projectId: project.id,
                level: 'error',
                service: 'api-gateway',
                message: 'Connection timeout',
            });

            const errors = await dashboardService.getRecentErrors(organization.id);

            expect(errors).toHaveLength(1);
            expect(errors[0]).toMatchObject({
                service: 'api-gateway',
                level: 'error',
                message: 'Connection timeout',
                projectId: project.id,
            });
            expect(errors[0].time).toBeDefined();
        });

        it('should limit to 10 errors', async () => {
            const { organization, project } = await createTestContext();

            // Create 15 error logs
            for (let i = 0; i < 15; i++) {
                await createTestLog({ projectId: project.id, level: 'error' });
            }

            const errors = await dashboardService.getRecentErrors(organization.id);

            expect(errors).toHaveLength(10);
        });

        it('should order by time descending (most recent first)', async () => {
            const { organization, project } = await createTestContext();

            // Create errors with slight time differences
            const now = new Date();
            await db
                .insertInto('logs')
                .values({
                    project_id: project.id,
                    service: 'test',
                    level: 'error',
                    message: 'Old error',
                    time: new Date(now.getTime() - 1000),
                })
                .execute();

            await db
                .insertInto('logs')
                .values({
                    project_id: project.id,
                    service: 'test',
                    level: 'error',
                    message: 'New error',
                    time: now,
                })
                .execute();

            const errors = await dashboardService.getRecentErrors(organization.id);

            expect(errors[0].message).toBe('New error');
            expect(errors[1].message).toBe('Old error');
        });

        it('should include trace_id when available', async () => {
            const { organization, project } = await createTestContext();
            const traceId = '550e8400-e29b-41d4-a716-446655440000';

            await db
                .insertInto('logs')
                .values({
                    project_id: project.id,
                    service: 'test',
                    level: 'error',
                    message: 'Error with trace',
                    time: new Date(),
                    trace_id: traceId,
                })
                .execute();

            const errors = await dashboardService.getRecentErrors(organization.id);

            expect(errors[0].traceId).toBe(traceId);
        });
    });
});
