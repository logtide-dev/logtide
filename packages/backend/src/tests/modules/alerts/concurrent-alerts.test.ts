import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import {
    createTestContext,
    createTestAlertRule,
    createTestLog,
    createTestProject,
    createTestOrganization,
} from '../../helpers/factories.js';
import { alertsService } from '../../../modules/alerts/service.js';

describe('Concurrent Alerts', () => {
    beforeEach(async () => {
        await db.deleteFrom('logs').execute();
        await db.deleteFrom('alert_history').execute();
        await db.deleteFrom('alert_rules').execute();
    });

    describe('Multiple Rules Triggering Simultaneously', () => {
        it('should trigger multiple rules at once when all thresholds are met', async () => {
            const { organization, project } = await createTestContext();

            // Create 3 different rules with different thresholds
            await createTestAlertRule({
                organizationId: organization.id,
                projectId: project.id,
                name: 'Rule 1 - Low Threshold',
                threshold: 1,
                timeWindow: 5,
            });

            await createTestAlertRule({
                organizationId: organization.id,
                projectId: project.id,
                name: 'Rule 2 - Medium Threshold',
                threshold: 3,
                timeWindow: 5,
            });

            await createTestAlertRule({
                organizationId: organization.id,
                projectId: project.id,
                name: 'Rule 3 - High Threshold',
                threshold: 5,
                timeWindow: 5,
            });

            // Create 5 error logs (should trigger all 3 rules)
            for (let i = 0; i < 5; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error ${i}`,
                });
            }

            const triggered = await alertsService.checkAlertRules();

            expect(triggered).toHaveLength(3);
            expect(triggered.map((t) => t.rule_name).sort()).toEqual([
                'Rule 1 - Low Threshold',
                'Rule 2 - Medium Threshold',
                'Rule 3 - High Threshold',
            ]);
        });

        it('should only trigger rules that meet their threshold', async () => {
            const { organization, project } = await createTestContext();

            await createTestAlertRule({
                organizationId: organization.id,
                projectId: project.id,
                name: 'Should Trigger',
                threshold: 2,
                timeWindow: 5,
            });

            await createTestAlertRule({
                organizationId: organization.id,
                projectId: project.id,
                name: 'Should NOT Trigger',
                threshold: 10,
                timeWindow: 5,
            });

            // Create 3 error logs
            for (let i = 0; i < 3; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error ${i}`,
                });
            }

            const triggered = await alertsService.checkAlertRules();

            expect(triggered).toHaveLength(1);
            expect(triggered[0].rule_name).toBe('Should Trigger');
        });
    });

    describe('Rules with Different Service Filters', () => {
        it('should independently evaluate rules for different services', async () => {
            const { organization, project } = await createTestContext();

            // Rule for API service
            await db
                .insertInto('alert_rules')
                .values({
                    organization_id: organization.id,
                    project_id: project.id,
                    name: 'API Errors',
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

            // Rule for Web service
            await db
                .insertInto('alert_rules')
                .values({
                    organization_id: organization.id,
                    project_id: project.id,
                    name: 'Web Errors',
                    service: 'web',
                    level: ['error'],
                    time_window: 5,
                    threshold: 2,
                    enabled: true,
                    email_recipients: [],
                    webhook_url: null,
                    metadata: null,
                })
                .execute();

            // Create 3 API errors
            for (let i = 0; i < 3; i++) {
                await createTestLog({
                    projectId: project.id,
                    service: 'api',
                    level: 'error',
                    message: `API Error ${i}`,
                });
            }

            // Create 1 Web error (below threshold)
            await createTestLog({
                projectId: project.id,
                service: 'web',
                level: 'error',
                message: 'Web Error',
            });

            const triggered = await alertsService.checkAlertRules();

            expect(triggered).toHaveLength(1);
            expect(triggered[0].rule_name).toBe('API Errors');
        });

        it('should trigger rules for multiple services when both thresholds are met', async () => {
            const { organization, project } = await createTestContext();

            // Rule for API service
            await db
                .insertInto('alert_rules')
                .values({
                    organization_id: organization.id,
                    project_id: project.id,
                    name: 'API Errors',
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

            // Rule for Web service
            await db
                .insertInto('alert_rules')
                .values({
                    organization_id: organization.id,
                    project_id: project.id,
                    name: 'Web Errors',
                    service: 'web',
                    level: ['error'],
                    time_window: 5,
                    threshold: 2,
                    enabled: true,
                    email_recipients: [],
                    webhook_url: null,
                    metadata: null,
                })
                .execute();

            // Create 3 API errors
            for (let i = 0; i < 3; i++) {
                await createTestLog({
                    projectId: project.id,
                    service: 'api',
                    level: 'error',
                    message: `API Error ${i}`,
                });
            }

            // Create 2 Web errors
            for (let i = 0; i < 2; i++) {
                await createTestLog({
                    projectId: project.id,
                    service: 'web',
                    level: 'error',
                    message: `Web Error ${i}`,
                });
            }

            const triggered = await alertsService.checkAlertRules();

            expect(triggered).toHaveLength(2);
            expect(triggered.map((t) => t.rule_name).sort()).toEqual([
                'API Errors',
                'Web Errors',
            ]);
        });
    });

    describe('Alerts from Different Projects', () => {
        it('should handle alerts from different projects independently', async () => {
            const { organization, project: project1 } = await createTestContext();

            // Create second project
            const project2 = await createTestProject({
                organizationId: organization.id,
                name: 'Project 2',
            });

            // Rule for project 1
            await createTestAlertRule({
                organizationId: organization.id,
                projectId: project1.id,
                name: 'Project 1 Alert',
                threshold: 2,
            });

            // Rule for project 2
            await createTestAlertRule({
                organizationId: organization.id,
                projectId: project2.id,
                name: 'Project 2 Alert',
                threshold: 2,
            });

            // Create 3 errors in project 1
            for (let i = 0; i < 3; i++) {
                await createTestLog({
                    projectId: project1.id,
                    level: 'error',
                    message: `P1 Error ${i}`,
                });
            }

            // Create 1 error in project 2 (below threshold)
            await createTestLog({
                projectId: project2.id,
                level: 'error',
                message: 'P2 Error',
            });

            const triggered = await alertsService.checkAlertRules();

            expect(triggered).toHaveLength(1);
            expect(triggered[0].rule_name).toBe('Project 1 Alert');
        });

        it('should trigger alerts in both projects when thresholds are met', async () => {
            const { organization, project: project1 } = await createTestContext();

            // Create second project
            const project2 = await createTestProject({
                organizationId: organization.id,
                name: 'Project 2',
            });

            // Rule for project 1
            await createTestAlertRule({
                organizationId: organization.id,
                projectId: project1.id,
                name: 'Project 1 Alert',
                threshold: 2,
            });

            // Rule for project 2
            await createTestAlertRule({
                organizationId: organization.id,
                projectId: project2.id,
                name: 'Project 2 Alert',
                threshold: 2,
            });

            // Create 2 errors in each project
            for (let i = 0; i < 2; i++) {
                await createTestLog({
                    projectId: project1.id,
                    level: 'error',
                    message: `P1 Error ${i}`,
                });
                await createTestLog({
                    projectId: project2.id,
                    level: 'error',
                    message: `P2 Error ${i}`,
                });
            }

            const triggered = await alertsService.checkAlertRules();

            expect(triggered).toHaveLength(2);
            expect(triggered.map((t) => t.rule_name).sort()).toEqual([
                'Project 1 Alert',
                'Project 2 Alert',
            ]);
        });
    });

    describe('Alerts from Different Organizations', () => {
        it('should isolate alerts between organizations', async () => {
            // Create first org with context
            const { organization: org1, project: project1 } = await createTestContext();

            // Create second org
            const org2 = await createTestOrganization({ name: 'Org 2' });
            const project2 = await createTestProject({
                organizationId: org2.id,
                name: 'Org 2 Project',
            });

            // Rule for org 1
            await createTestAlertRule({
                organizationId: org1.id,
                projectId: project1.id,
                name: 'Org 1 Alert',
                threshold: 2,
            });

            // Rule for org 2
            await createTestAlertRule({
                organizationId: org2.id,
                projectId: project2.id,
                name: 'Org 2 Alert',
                threshold: 2,
            });

            // Create 3 errors in org 1
            for (let i = 0; i < 3; i++) {
                await createTestLog({
                    projectId: project1.id,
                    level: 'error',
                    message: `Org 1 Error ${i}`,
                });
            }

            // Create 3 errors in org 2
            for (let i = 0; i < 3; i++) {
                await createTestLog({
                    projectId: project2.id,
                    level: 'error',
                    message: `Org 2 Error ${i}`,
                });
            }

            const triggered = await alertsService.checkAlertRules();

            // Both should trigger
            expect(triggered).toHaveLength(2);

            // Verify correct log counts per rule
            const org1Alert = triggered.find((t) => t.rule_name === 'Org 1 Alert');
            const org2Alert = triggered.find((t) => t.rule_name === 'Org 2 Alert');

            expect(org1Alert?.log_count).toBe(3);
            expect(org2Alert?.log_count).toBe(3);
        });

        it('should NOT count logs from other organizations', async () => {
            // Create first org with context
            const { organization: org1, project: project1 } = await createTestContext();

            // Create second org
            const org2 = await createTestOrganization({ name: 'Org 2' });
            const project2 = await createTestProject({
                organizationId: org2.id,
                name: 'Org 2 Project',
            });

            // Rule for org 1 only
            await createTestAlertRule({
                organizationId: org1.id,
                projectId: project1.id,
                name: 'Org 1 Alert',
                threshold: 5,
            });

            // Create 2 errors in org 1 (below threshold)
            for (let i = 0; i < 2; i++) {
                await createTestLog({
                    projectId: project1.id,
                    level: 'error',
                    message: `Org 1 Error ${i}`,
                });
            }

            // Create 10 errors in org 2 (should not affect org 1)
            for (let i = 0; i < 10; i++) {
                await createTestLog({
                    projectId: project2.id,
                    level: 'error',
                    message: `Org 2 Error ${i}`,
                });
            }

            const triggered = await alertsService.checkAlertRules();

            // Org 1 should NOT trigger (only 2 logs, threshold is 5)
            // The org 2 logs should NOT be counted
            expect(triggered).toHaveLength(0);
        });
    });

    describe('Rules with Different Levels', () => {
        it('should trigger rules for different log levels independently', async () => {
            const { organization, project } = await createTestContext();

            // Rule for error level
            await db
                .insertInto('alert_rules')
                .values({
                    organization_id: organization.id,
                    project_id: project.id,
                    name: 'Error Alert',
                    service: null,
                    level: ['error'],
                    time_window: 5,
                    threshold: 2,
                    enabled: true,
                    email_recipients: [],
                    webhook_url: null,
                    metadata: null,
                })
                .execute();

            // Rule for warn level
            await db
                .insertInto('alert_rules')
                .values({
                    organization_id: organization.id,
                    project_id: project.id,
                    name: 'Warn Alert',
                    service: null,
                    level: ['warn'],
                    time_window: 5,
                    threshold: 3,
                    enabled: true,
                    email_recipients: [],
                    webhook_url: null,
                    metadata: null,
                })
                .execute();

            // Create 2 error logs
            for (let i = 0; i < 2; i++) {
                await createTestLog({
                    projectId: project.id,
                    level: 'error',
                    message: `Error ${i}`,
                });
            }

            // Create 1 warn log (below threshold)
            await createTestLog({
                projectId: project.id,
                level: 'warn',
                message: 'Warning',
            });

            const triggered = await alertsService.checkAlertRules();

            expect(triggered).toHaveLength(1);
            expect(triggered[0].rule_name).toBe('Error Alert');
        });
    });

    describe('Alert History Recording for Multiple Rules', () => {
        it('should record separate history entries for each triggered rule', async () => {
            const { organization, project } = await createTestContext();

            const rule1 = await createTestAlertRule({
                organizationId: organization.id,
                projectId: project.id,
                name: 'Rule 1',
                threshold: 1,
            });

            const rule2 = await createTestAlertRule({
                organizationId: organization.id,
                projectId: project.id,
                name: 'Rule 2',
                threshold: 1,
            });

            // Create error log
            await createTestLog({
                projectId: project.id,
                level: 'error',
                message: 'Error',
            });

            const triggered = await alertsService.checkAlertRules();
            expect(triggered).toHaveLength(2);

            // Check history
            const history = await db
                .selectFrom('alert_history')
                .selectAll()
                .execute();

            expect(history).toHaveLength(2);

            const ruleIds = history.map((h) => h.rule_id);
            expect(ruleIds).toContain(rule1.id);
            expect(ruleIds).toContain(rule2.id);
        });
    });
});
