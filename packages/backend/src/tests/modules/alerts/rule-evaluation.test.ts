import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import {
    createTestContext,
    createTestAlertRule,
    createTestLog,
    createTestProject,
} from '../../helpers/factories.js';
import { alertsService } from '../../../modules/alerts/service.js';

describe('Alert Rule Evaluation', () => {
    beforeEach(async () => {
        await db.deleteFrom('logs').execute();
        await db.deleteFrom('alert_history').execute();
        await db.deleteFrom('alert_rules').execute();
    });

    describe('Threshold Calculation', () => {
        it('should trigger alert when log count meets threshold', async () => {
            const { organization, project } = await createTestContext();

            const rule = await createTestAlertRule({
                organizationId: organization.id,
                projectId: project.id,
                name: 'Threshold Test',
                threshold: 3,
                timeWindow: 5,
            });

            // Create exactly 3 error logs (meeting threshold)
            for (let i = 0; i < 3; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error log ${i}`,
                });
            }

            const triggered = await alertsService.checkAlertRules();

            expect(triggered).toHaveLength(1);
            expect(triggered[0].rule_name).toBe('Threshold Test');
            expect(triggered[0].log_count).toBe(3);
        });

        it('should NOT trigger alert when log count is below threshold', async () => {
            const { organization, project } = await createTestContext();

            await createTestAlertRule({
                organizationId: organization.id,
                projectId: project.id,
                name: 'Below Threshold Test',
                threshold: 5,
                timeWindow: 5,
            });

            // Create only 2 error logs (below threshold of 5)
            for (let i = 0; i < 2; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error log ${i}`,
                });
            }

            const triggered = await alertsService.checkAlertRules();

            expect(triggered).toHaveLength(0);
        });

        it('should trigger alert when log count exceeds threshold', async () => {
            const { organization, project } = await createTestContext();

            const rule = await createTestAlertRule({
                organizationId: organization.id,
                projectId: project.id,
                name: 'Exceed Threshold Test',
                threshold: 2,
                timeWindow: 5,
            });

            // Create 5 error logs (exceeds threshold of 2)
            for (let i = 0; i < 5; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error log ${i}`,
                });
            }

            const triggered = await alertsService.checkAlertRules();

            expect(triggered).toHaveLength(1);
            expect(triggered[0].log_count).toBe(5);
        });
    });

    describe('Time Window Logic', () => {
        it('should only count logs within time window', async () => {
            const { organization, project } = await createTestContext();

            await createTestAlertRule({
                organizationId: organization.id,
                projectId: project.id,
                name: 'Time Window Test',
                threshold: 3,
                timeWindow: 1, // 1 minute window
            });

            // Create 2 logs outside the window (2 minutes ago)
            const oldTime = new Date(Date.now() - 2 * 60 * 1000);
            for (let i = 0; i < 2; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Old error ${i}`,
                    time: oldTime,
                });
            }

            // Create 2 logs within the window (now)
            for (let i = 0; i < 2; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `New error ${i}`,
                });
            }

            const triggered = await alertsService.checkAlertRules();

            // Should NOT trigger because only 2 logs are within the 1-minute window
            expect(triggered).toHaveLength(0);
        });

        it('should trigger when enough logs are within time window', async () => {
            const { organization, project } = await createTestContext();

            const rule = await createTestAlertRule({
                organizationId: organization.id,
                projectId: project.id,
                name: 'Time Window Trigger Test',
                threshold: 3,
                timeWindow: 5, // 5 minute window
            });

            // Create 3 logs within the window
            for (let i = 0; i < 3; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error ${i}`,
                });
            }

            const triggered = await alertsService.checkAlertRules();

            expect(triggered).toHaveLength(1);
            expect(triggered[0].log_count).toBe(3);
        });
    });

    describe('Duplicate Prevention', () => {
        it('should NOT re-trigger on the same logs', async () => {
            const { organization, project } = await createTestContext();

            const rule = await createTestAlertRule({
                organizationId: organization.id,
                projectId: project.id,
                name: 'Duplicate Prevention Test',
                threshold: 2,
                timeWindow: 5,
            });

            // Create 2 error logs
            for (let i = 0; i < 2; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error ${i}`,
                });
            }

            // First check should trigger
            const firstCheck = await alertsService.checkAlertRules();
            expect(firstCheck).toHaveLength(1);

            // Second check should NOT trigger (same logs)
            const secondCheck = await alertsService.checkAlertRules();
            expect(secondCheck).toHaveLength(0);
        });

        it('should not notify again while the rule is still firing', async () => {
            const { organization, project } = await createTestContext();

            const rule = await createTestAlertRule({
                organizationId: organization.id,
                projectId: project.id,
                name: 'New Logs Trigger Test',
                threshold: 2,
                timeWindow: 5,
            });

            // Create 2 error logs
            for (let i = 0; i < 2; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error ${i}`,
                });
            }

            // First check should trigger
            const firstCheck = await alertsService.checkAlertRules();
            expect(firstCheck).toHaveLength(1);

            // Create 2 MORE error logs (after the first trigger)
            await new Promise((resolve) => setTimeout(resolve, 100)); // Small delay
            for (let i = 0; i < 2; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `New Error ${i}`,
                });
            }

            // Second check: the rule is still firing and has no re-notify
            // interval, so it stays quiet (1.6 lifecycle semantics).
            const secondCheck = await alertsService.checkAlertRules();
            expect(secondCheck).toHaveLength(0);

            const history = await db
                .selectFrom('alert_history')
                .select('id')
                .where('rule_id', '=', rule.id)
                .execute();
            expect(history).toHaveLength(1);
        });
    });

    describe('Disabled Rules', () => {
        it('should NOT trigger disabled rules', async () => {
            const { organization, project } = await createTestContext();

            await createTestAlertRule({
                organizationId: organization.id,
                projectId: project.id,
                name: 'Disabled Rule Test',
                threshold: 1,
                timeWindow: 5,
                enabled: false,
            });

            // Create error logs
            await createTestLog({
                projectId: project.id,
                level: 'error',
                message: 'Error log',
            });

            const triggered = await alertsService.checkAlertRules();

            expect(triggered).toHaveLength(0);
        });

        it('should trigger enabled rules only', async () => {
            const { organization, project } = await createTestContext();

            // Disabled rule
            await createTestAlertRule({
                organizationId: organization.id,
                projectId: project.id,
                name: 'Disabled Rule',
                threshold: 1,
                timeWindow: 5,
                enabled: false,
            });

            // Enabled rule
            await createTestAlertRule({
                organizationId: organization.id,
                projectId: project.id,
                name: 'Enabled Rule',
                threshold: 1,
                timeWindow: 5,
                enabled: true,
            });

            await createTestLog({
                projectId: project.id,
                level: 'error',
                message: 'Error log',
            });

            const triggered = await alertsService.checkAlertRules();

            expect(triggered).toHaveLength(1);
            expect(triggered[0].rule_name).toBe('Enabled Rule');
        });
    });

    describe('Level Filter', () => {
        it('should only count logs matching the configured level', async () => {
            const { organization, project } = await createTestContext();

            // Rule that monitors only 'error' level
            await createTestAlertRule({
                organizationId: organization.id,
                projectId: project.id,
                name: 'Error Level Only',
                threshold: 2,
                timeWindow: 5,
            });

            // Create info logs (should not be counted)
            for (let i = 0; i < 5; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'info',
                    message: `Info log ${i}`,
                });
            }

            // Create 1 error log (below threshold)
            await createTestLog({
                projectId: project.id,
                level: 'error',
                message: 'Error log',
            });

            const triggered = await alertsService.checkAlertRules();

            // Should NOT trigger because only 1 error log
            expect(triggered).toHaveLength(0);
        });

        it('should count logs of multiple levels when configured', async () => {
            const { organization, project } = await createTestContext();

            // Create rule with multiple levels
            const rule = await db
                .insertInto('alert_rules')
                .values({
                    organization_id: organization.id,
                    project_id: project.id,
                    name: 'Multi-Level Rule',
                    service: null,
                    level: ['error', 'warn'],
                    time_window: 5,
                    threshold: 3,
                    enabled: true,
                    email_recipients: [],
                    webhook_url: null,
                    metadata: null,
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            // Create 2 error logs
            for (let i = 0; i < 2; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error ${i}`,
                });
            }

            // Create 2 warn logs
            for (let i = 0; i < 2; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'warn',
                    message: `Warn ${i}`,
                });
            }

            const triggered = await alertsService.checkAlertRules();

            // Should trigger: 2 error + 2 warn = 4 >= threshold 3
            expect(triggered).toHaveLength(1);
            expect(triggered[0].log_count).toBe(4);
        });
    });

    describe('Project Scoping', () => {
        it('should only count logs from the configured project', async () => {
            const { organization, project: project1 } = await createTestContext();

            // Create a second project in the same org
            const project2 = await createTestProject({
                organizationId: organization.id,
                name: 'Second Project',
            });

            // Rule scoped to project1
            await createTestAlertRule({
                organizationId: organization.id,
                projectId: project1.id,
                name: 'Project 1 Rule',
                threshold: 2,
                timeWindow: 5,
            });

            // Create 3 error logs in project2 (should not be counted)
            for (let i = 0; i < 3; i++) {
                await createTestLog({
                    projectId: project2.id,
                    level: 'error',
                    message: `Project 2 Error ${i}`,
                });
            }

            // Create 1 error log in project1 (below threshold)
            await createTestLog({
                projectId: project1.id,
                level: 'error',
                message: 'Project 1 Error',
            });

            const triggered = await alertsService.checkAlertRules();

            // Should NOT trigger (only 1 log in project1)
            expect(triggered).toHaveLength(0);
        });

        it('should count logs from all org projects for org-level rules', async () => {
            const { organization, project: project1 } = await createTestContext();

            // Create a second project in the same org
            const project2 = await createTestProject({
                organizationId: organization.id,
                name: 'Second Project',
            });

            // Org-level rule (projectId = null)
            await createTestAlertRule({
                organizationId: organization.id,
                projectId: null,
                name: 'Org Level Rule',
                threshold: 3,
                timeWindow: 5,
            });

            // Create 2 error logs in project1
            for (let i = 0; i < 2; i++) {
                await createTestLog({
                    projectId: project1.id,
                    level: 'error',
                    message: `Project 1 Error ${i}`,
                });
            }

            // Create 2 error logs in project2
            for (let i = 0; i < 2; i++) {
                await createTestLog({
                    projectId: project2.id,
                    level: 'error',
                    message: `Project 2 Error ${i}`,
                });
            }

            const triggered = await alertsService.checkAlertRules();

            // Should trigger: 2 + 2 = 4 >= threshold 3
            expect(triggered).toHaveLength(1);
            expect(triggered[0].log_count).toBe(4);
        });
    });

    describe('Service Filter', () => {
        it('should only count logs from the configured service', async () => {
            const { organization, project } = await createTestContext();

            // Create rule for specific service
            await db
                .insertInto('alert_rules')
                .values({
                    organization_id: organization.id,
                    project_id: project.id,
                    name: 'API Service Rule',
                    service: 'api',
                    level: ['error'],
                    time_window: 5,
                    threshold: 2,
                    enabled: true,
                    email_recipients: [],
                    webhook_url: null,
                    metadata: null,
                })
                .execute();

            // Create 3 error logs from 'web' service (should not be counted)
            for (let i = 0; i < 3; i++) {
                await createTestLog({
                    projectId: project.id,
                    service: 'web',
                    level: 'error',
                    message: `Web Error ${i}`,
                });
            }

            // Create 1 error log from 'api' service (below threshold)
            await createTestLog({
                projectId: project.id,
                service: 'api',
                level: 'error',
                message: 'API Error',
            });

            const triggered = await alertsService.checkAlertRules();

            // Should NOT trigger (only 1 log from 'api' service)
            expect(triggered).toHaveLength(0);
        });

        it('should trigger when enough logs from configured service', async () => {
            const { organization, project } = await createTestContext();

            // Create rule for specific service
            await db
                .insertInto('alert_rules')
                .values({
                    organization_id: organization.id,
                    project_id: project.id,
                    name: 'Payment Service Rule',
                    service: 'payment',
                    level: ['error'],
                    time_window: 5,
                    threshold: 2,
                    enabled: true,
                    email_recipients: [],
                    webhook_url: null,
                    metadata: null,
                })
                .execute();

            // Create 2 error logs from 'payment' service
            for (let i = 0; i < 2; i++) {
                await createTestLog({
                    projectId: project.id,
                    service: 'payment',
                    level: 'error',
                    message: `Payment Error ${i}`,
                });
            }

            const triggered = await alertsService.checkAlertRules();

            expect(triggered).toHaveLength(1);
            expect(triggered[0].log_count).toBe(2);
        });
    });

    describe('Alert History Recording', () => {
        it('should record triggered alert in history', async () => {
            const { organization, project } = await createTestContext();

            const rule = await createTestAlertRule({
                organizationId: organization.id,
                projectId: project.id,
                name: 'History Test Rule',
                threshold: 1,
                timeWindow: 5,
            });

            await createTestLog({
                projectId: project.id,
                level: 'error',
                message: 'Test error',
            });

            const triggered = await alertsService.checkAlertRules();
            expect(triggered).toHaveLength(1);

            // Check history was recorded
            const history = await alertsService.getAlertHistory(organization.id);
            expect(history.total).toBe(1);
            expect(history.history[0].ruleId).toBe(rule.id);
            expect(history.history[0].logCount).toBe(1);
        });
    });
});
