import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import {
    createTestContext,
    createTestLog,
    createTestProject,
} from '../../helpers/factories.js';
import { alertsService } from '../../../modules/alerts/service.js';
import type { PreviewAlertRuleInput, PreviewRange } from '../../../modules/alerts/service.js';

describe('Alert Rule Preview', () => {
    beforeEach(async () => {
        await db.deleteFrom('logs').execute();
        await db.deleteFrom('alert_history').execute();
        await db.deleteFrom('alert_rules').execute();
    });

    describe('previewAlertRule', () => {
        it('should return empty result when organization has no projects', async () => {
            const { organization } = await createTestContext();

            // Delete all projects for this organization
            await db.deleteFrom('api_keys').execute();
            await db.deleteFrom('projects').where('organization_id', '=', organization.id).execute();

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                level: ['error'],
                threshold: 5,
                timeWindow: 5,
                previewRange: '1d',
            };

            const result = await alertsService.previewAlertRule(input);

            expect(result.summary.totalTriggers).toBe(0);
            expect(result.summary.totalIncidents).toBe(0);
            expect(result.incidents).toHaveLength(0);
        });

        it('should return empty result with no_data suggestion when no logs found', async () => {
            const { organization, project } = await createTestContext();

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                projectId: project.id,
                level: ['error'],
                threshold: 5,
                timeWindow: 5,
                previewRange: '1d',
            };

            const result = await alertsService.previewAlertRule(input);

            expect(result.summary.totalTriggers).toBe(0);
            expect(result.summary.totalIncidents).toBe(0);
            expect(result.suggestions).toContainEqual(
                expect.objectContaining({
                    type: 'no_data',
                    severity: 'info',
                })
            );
        });

        it('should detect incidents when logs exceed threshold', async () => {
            const { organization, project } = await createTestContext();

            // Create 10 error logs within the last hour
            const now = new Date();
            for (let i = 0; i < 10; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error log ${i}`,
                    time: new Date(now.getTime() - i * 60000), // 1 minute apart
                });
            }

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                projectId: project.id,
                level: ['error'],
                threshold: 3,
                timeWindow: 5,
                previewRange: '1d',
            };

            const result = await alertsService.previewAlertRule(input);

            expect(result.summary.totalIncidents).toBeGreaterThanOrEqual(1);
            expect(result.incidents.length).toBeGreaterThanOrEqual(1);
        });

        it('should filter by service when specified', async () => {
            const { organization, project } = await createTestContext();

            const now = new Date();
            // Create logs for different services
            for (let i = 0; i < 5; i++) {
                await createTestLog({
                    projectId: project.id,
                    service: 'api-service',
                    level: 'error',
                    message: `API error ${i}`,
                    time: new Date(now.getTime() - i * 60000),
                });
            }
            for (let i = 0; i < 5; i++) {
                await createTestLog({
                    projectId: project.id,
                    service: 'worker-service',
                    level: 'error',
                    message: `Worker error ${i}`,
                    time: new Date(now.getTime() - i * 60000),
                });
            }

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                projectId: project.id,
                service: 'api-service',
                level: ['error'],
                threshold: 3,
                timeWindow: 5,
                previewRange: '1d',
            };

            const result = await alertsService.previewAlertRule(input);

            // Affected services should only contain api-service
            expect(result.summary.affectedServices).toContain('api-service');
            expect(result.summary.affectedServices).not.toContain('worker-service');
        });

        it('should filter by multiple log levels', async () => {
            const { organization, project } = await createTestContext();

            const now = new Date();
            // Create logs with different levels
            for (let i = 0; i < 3; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error ${i}`,
                    time: new Date(now.getTime() - i * 60000),
                });
            }
            for (let i = 0; i < 3; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'warn',
                    message: `Warning ${i}`,
                    time: new Date(now.getTime() - i * 60000),
                });
            }
            for (let i = 0; i < 3; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'info',
                    message: `Info ${i}`,
                    time: new Date(now.getTime() - i * 60000),
                });
            }

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                projectId: project.id,
                level: ['error', 'warn'],
                threshold: 2,
                timeWindow: 5,
                previewRange: '1d',
            };

            const result = await alertsService.previewAlertRule(input);

            // Should count error + warn but not info
            expect(result.summary.totalIncidents).toBeGreaterThanOrEqual(1);
        });

        it('should use different bucket intervals based on time range', async () => {
            const { organization, project } = await createTestContext();

            const now = new Date();
            for (let i = 0; i < 5; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error ${i}`,
                    time: new Date(now.getTime() - i * 60000),
                });
            }

            // Test each time range
            const ranges: PreviewRange[] = ['1d', '7d', '14d', '30d'];
            for (const range of ranges) {
                const input: PreviewAlertRuleInput = {
                    organizationId: organization.id,
                    projectId: project.id,
                    level: ['error'],
                    threshold: 2,
                    timeWindow: 5,
                    previewRange: range,
                };

                const result = await alertsService.previewAlertRule(input);
                expect(result.summary.timeRange.from).toBeInstanceOf(Date);
                expect(result.summary.timeRange.to).toBeInstanceOf(Date);
            }
        });

        it('should preview for entire organization when projectId is null', async () => {
            const { organization, project } = await createTestContext();
            const project2 = await createTestProject({ organizationId: organization.id });

            const now = new Date();
            // Create logs in both projects
            for (let i = 0; i < 3; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Project 1 error ${i}`,
                    time: new Date(now.getTime() - i * 60000),
                });
            }
            for (let i = 0; i < 3; i++) {
                await createTestLog({
                    projectId: project2.id,
                    level: 'error',
                    message: `Project 2 error ${i}`,
                    time: new Date(now.getTime() - i * 60000),
                });
            }

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                projectId: null,
                level: ['error'],
                threshold: 2,
                timeWindow: 5,
                previewRange: '1d',
            };

            const result = await alertsService.previewAlertRule(input);

            // Should include logs from both projects
            expect(result.summary.totalIncidents).toBeGreaterThanOrEqual(1);
        });

        it('should include sample logs in incidents', async () => {
            const { organization, project } = await createTestContext();

            const now = new Date();
            for (let i = 0; i < 10; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Sample error message ${i}`,
                    service: 'test-service',
                    time: new Date(now.getTime() - i * 60000),
                });
            }

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                projectId: project.id,
                level: ['error'],
                threshold: 3,
                timeWindow: 5,
                previewRange: '1d',
            };

            const result = await alertsService.previewAlertRule(input);

            if (result.incidents.length > 0) {
                const incident = result.incidents[0];
                expect(incident.sampleLogs).toBeDefined();
                expect(incident.sampleLogs.length).toBeLessThanOrEqual(5);
                if (incident.sampleLogs.length > 0) {
                    expect(incident.sampleLogs[0]).toHaveProperty('message');
                    expect(incident.sampleLogs[0]).toHaveProperty('service');
                    expect(incident.sampleLogs[0]).toHaveProperty('level');
                }
            }
        });

        it('should limit incidents to top 10', async () => {
            const { organization, project } = await createTestContext();

            // Create many logs spread over time to generate many incidents
            const now = new Date();
            for (let day = 0; day < 20; day++) {
                for (let i = 0; i < 5; i++) {
                    await createTestLog({
                        projectId: project.id,
                        level: 'error',
                        message: `Error on day ${day} - ${i}`,
                        time: new Date(now.getTime() - day * 24 * 60 * 60 * 1000 - i * 60000),
                    });
                }
            }

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                projectId: project.id,
                level: ['error'],
                threshold: 2,
                timeWindow: 5,
                previewRange: '30d',
            };

            const result = await alertsService.previewAlertRule(input);

            // Only top 10 incidents should have sample logs
            expect(result.incidents.length).toBeLessThanOrEqual(10);
        });
    });

    describe('statistics computation', () => {
        it('should compute incident duration statistics', async () => {
            const { organization, project } = await createTestContext();

            const now = new Date();
            for (let i = 0; i < 20; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error ${i}`,
                    time: new Date(now.getTime() - i * 60000),
                });
            }

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                projectId: project.id,
                level: ['error'],
                threshold: 2,
                timeWindow: 5,
                previewRange: '1d',
            };

            const result = await alertsService.previewAlertRule(input);

            expect(result.statistics.incidents).toHaveProperty('averageDuration');
            expect(result.statistics.incidents).toHaveProperty('maxDuration');
            expect(result.statistics.incidents).toHaveProperty('minDuration');
        });

        it('should compute temporal patterns by day of week', async () => {
            const { organization, project } = await createTestContext();

            const now = new Date();
            for (let i = 0; i < 10; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error ${i}`,
                    time: new Date(now.getTime() - i * 60000),
                });
            }

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                projectId: project.id,
                level: ['error'],
                threshold: 2,
                timeWindow: 5,
                previewRange: '1d',
            };

            const result = await alertsService.previewAlertRule(input);

            expect(result.statistics.temporalPatterns.byDayOfWeek).toHaveLength(7);
            expect(result.statistics.temporalPatterns.byDayOfWeek[0]).toHaveProperty('day');
            expect(result.statistics.temporalPatterns.byDayOfWeek[0]).toHaveProperty('count');
        });

        it('should compute temporal patterns by hour of day', async () => {
            const { organization, project } = await createTestContext();

            const now = new Date();
            for (let i = 0; i < 10; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error ${i}`,
                    time: new Date(now.getTime() - i * 60000),
                });
            }

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                projectId: project.id,
                level: ['error'],
                threshold: 2,
                timeWindow: 5,
                previewRange: '1d',
            };

            const result = await alertsService.previewAlertRule(input);

            expect(result.statistics.temporalPatterns.byHourOfDay).toHaveLength(24);
            expect(result.statistics.temporalPatterns.byHourOfDay[0]).toHaveProperty('hour');
            expect(result.statistics.temporalPatterns.byHourOfDay[0]).toHaveProperty('count');
        });

        it('should compute threshold analysis with percentiles', async () => {
            const { organization, project } = await createTestContext();

            const now = new Date();
            for (let i = 0; i < 20; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error ${i}`,
                    time: new Date(now.getTime() - i * 60000),
                });
            }

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                projectId: project.id,
                level: ['error'],
                threshold: 2,
                timeWindow: 5,
                previewRange: '1d',
            };

            const result = await alertsService.previewAlertRule(input);

            expect(result.statistics.thresholdAnalysis).toHaveProperty('percentAboveThreshold');
            expect(result.statistics.thresholdAnalysis).toHaveProperty('p50Value');
            expect(result.statistics.thresholdAnalysis).toHaveProperty('p95Value');
            expect(result.statistics.thresholdAnalysis).toHaveProperty('p99Value');
        });
    });

    describe('suggestions generation', () => {
        it('should suggest raising threshold when too many triggers', async () => {
            const { organization, project } = await createTestContext();

            // Create many logs to trigger suggestion
            const now = new Date();
            for (let i = 0; i < 100; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error ${i}`,
                    time: new Date(now.getTime() - i * 60000),
                });
            }

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                projectId: project.id,
                level: ['error'],
                threshold: 1, // Very low threshold
                timeWindow: 5,
                previewRange: '1d',
            };

            const result = await alertsService.previewAlertRule(input);

            // Should have suggestion to raise threshold
            const thresholdSuggestion = result.suggestions.find(
                (s) => s.type === 'threshold_too_low'
            );
            if (result.statistics.thresholdAnalysis.percentAboveThreshold > 15) {
                expect(thresholdSuggestion).toBeDefined();
            }
        });

        it('should suggest lowering threshold when no triggers', async () => {
            const { organization, project } = await createTestContext();

            // Create some logs but with a very high threshold
            const now = new Date();
            for (let i = 0; i < 10; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error ${i}`,
                    time: new Date(now.getTime() - i * 60000),
                });
            }

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                projectId: project.id,
                level: ['error'],
                threshold: 1000, // Very high threshold
                timeWindow: 5,
                previewRange: '1d',
            };

            const result = await alertsService.previewAlertRule(input);

            if (result.incidents.length === 0 && result.statistics.thresholdAnalysis.p99Value > 0) {
                const thresholdSuggestion = result.suggestions.find(
                    (s) => s.type === 'threshold_too_high'
                );
                expect(thresholdSuggestion).toBeDefined();
            }
        });
    });

    describe('incident clustering', () => {
        it('should cluster consecutive buckets into single incident', async () => {
            const { organization, project } = await createTestContext();

            // Create logs in rapid succession
            const now = new Date();
            for (let i = 0; i < 20; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error ${i}`,
                    time: new Date(now.getTime() - i * 60000),
                });
            }

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                projectId: project.id,
                level: ['error'],
                threshold: 2,
                timeWindow: 5,
                previewRange: '1d',
            };

            const result = await alertsService.previewAlertRule(input);

            // Should have incidents with duration > 0
            if (result.incidents.length > 0) {
                const incident = result.incidents[0];
                expect(incident).toHaveProperty('startTime');
                expect(incident).toHaveProperty('endTime');
                expect(incident).toHaveProperty('durationMinutes');
                expect(incident).toHaveProperty('triggerCount');
                expect(incident).toHaveProperty('peakValue');
                expect(incident).toHaveProperty('averageValue');
            }
        });

        it('should create separate incidents for gaps in data', async () => {
            const { organization, project } = await createTestContext();

            const now = new Date();
            // First burst of logs
            for (let i = 0; i < 5; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `First burst ${i}`,
                    time: new Date(now.getTime() - i * 60000),
                });
            }

            // Gap, then second burst (3 hours later)
            for (let i = 0; i < 5; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Second burst ${i}`,
                    time: new Date(now.getTime() - 3 * 60 * 60 * 1000 - i * 60000),
                });
            }

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                projectId: project.id,
                level: ['error'],
                threshold: 2,
                timeWindow: 5,
                previewRange: '1d',
            };

            const result = await alertsService.previewAlertRule(input);

            // Should potentially have multiple separate incidents
            expect(result.incidents.length).toBeGreaterThanOrEqual(1);
        });

        it('should track peak value in incidents', async () => {
            const { organization, project } = await createTestContext();

            const now = new Date();
            // Create varying number of logs at different times
            for (let i = 0; i < 30; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error ${i}`,
                    time: new Date(now.getTime() - i * 60000),
                });
            }

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                projectId: project.id,
                level: ['error'],
                threshold: 2,
                timeWindow: 5,
                previewRange: '1d',
            };

            const result = await alertsService.previewAlertRule(input);

            if (result.incidents.length > 0) {
                expect(result.incidents[0].peakValue).toBeGreaterThanOrEqual(
                    result.incidents[0].averageValue
                );
            }
        });
    });

    describe('affected services', () => {
        it('should list all affected services', async () => {
            const { organization, project } = await createTestContext();

            const now = new Date();
            const services = ['api', 'worker', 'scheduler'];
            for (const service of services) {
                for (let i = 0; i < 5; i++) {
                    await createTestLog({
                        projectId: project.id,
                        service,
                        level: 'error',
                        message: `${service} error ${i}`,
                        time: new Date(now.getTime() - i * 60000),
                    });
                }
            }

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                projectId: project.id,
                level: ['error'],
                threshold: 2,
                timeWindow: 5,
                previewRange: '1d',
            };

            const result = await alertsService.previewAlertRule(input);

            for (const service of services) {
                expect(result.summary.affectedServices).toContain(service);
            }
        });

        it('should exclude "unknown" service from affected list', async () => {
            const { organization, project } = await createTestContext();

            const now = new Date();
            for (let i = 0; i < 5; i++) {
                await createTestLog({
                    projectId: project.id,
                    service: 'unknown',
                    level: 'error',
                    message: `Unknown error ${i}`,
                    time: new Date(now.getTime() - i * 60000),
                });
            }
            for (let i = 0; i < 5; i++) {
                await createTestLog({
                    projectId: project.id,
                    service: 'known-service',
                    level: 'error',
                    message: `Known error ${i}`,
                    time: new Date(now.getTime() - i * 60000),
                });
            }

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                projectId: project.id,
                level: ['error'],
                threshold: 2,
                timeWindow: 5,
                previewRange: '1d',
            };

            const result = await alertsService.previewAlertRule(input);

            expect(result.summary.affectedServices).not.toContain('unknown');
            expect(result.summary.affectedServices).toContain('known-service');
        });
    });

    describe('edge cases', () => {
        it('should handle empty statistics gracefully', async () => {
            const { organization, project } = await createTestContext();

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                projectId: project.id,
                level: ['error'],
                threshold: 100,
                timeWindow: 5,
                previewRange: '1d',
            };

            const result = await alertsService.previewAlertRule(input);

            // Empty stats should have zero values
            expect(result.statistics.incidents.averageDuration).toBe(0);
            expect(result.statistics.incidents.maxDuration).toBe(0);
            expect(result.statistics.incidents.minDuration).toBe(0);
        });

        it('should handle logs with trace_id', async () => {
            const { organization, project } = await createTestContext();

            const now = new Date();
            for (let i = 0; i < 5; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error ${i}`,
                    trace_id: `trace-${i}`,
                    time: new Date(now.getTime() - i * 60000),
                });
            }

            const input: PreviewAlertRuleInput = {
                organizationId: organization.id,
                projectId: project.id,
                level: ['error'],
                threshold: 2,
                timeWindow: 5,
                previewRange: '1d',
            };

            const result = await alertsService.previewAlertRule(input);

            if (result.incidents.length > 0 && result.incidents[0].sampleLogs.length > 0) {
                expect(result.incidents[0].sampleLogs[0]).toHaveProperty('traceId');
            }
        });
    });
});
