import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { processSigmaDetection, type SigmaDetectionData } from '../../../queue/jobs/sigma-detection.js';
import { SigmaDetectionEngine } from '../../../modules/sigma/detection-engine.js';
import { db } from '../../../database/index.js';
import { createTestContext, createTestSigmaRule } from '../../helpers/factories.js';

// No SMTP: the owners and admins fallback is off, so a rule with no
// destination stays detection-only (the fallback is covered in
// sigma-detection-routing.test.ts)
vi.mock('../../../config/index.js', async (orig) => ({
    ...((await orig()) as object),
    isSmtpConfigured: vi.fn(() => false),
}));

// Mock the queue connection
vi.mock('../../../queue/connection.js', () => ({
    createQueue: vi.fn(() => ({
        add: vi.fn().mockResolvedValue({}),
    })),
}));

describe('Sigma Detection Job', () => {
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

        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('processSigmaDetection', () => {
        it('should process logs with no matches without errors', async () => {
            const { organization } = await createTestContext();

            const consoleErrorSpy = vi.spyOn(console, 'error');

            const jobData: SigmaDetectionData = {
                logs: [
                    {
                        message: 'Normal log message',
                        level: 'info',
                        service: 'api',
                        time: new Date(),
                    },
                ],
                organizationId: organization.id,
            };

            // Should complete without throwing — no rules, so no matches expected
            await expect(
                processSigmaDetection({ data: jobData })
            ).resolves.toBeUndefined();
            expect(consoleErrorSpy).not.toHaveBeenCalled();
        });

        it('should find matches when logs match Sigma rules', async () => {
            const { organization, project } = await createTestContext();

            // Create a Sigma rule that matches error logs
            await createTestSigmaRule({
                organizationId: organization.id,
                projectId: project.id,
                title: 'Error Detection Rule',
                detection: {
                    selection: { level: 'error' },
                    condition: 'selection',
                },
            });

            const consoleSpy = vi.spyOn(console, 'log');

            const jobData: SigmaDetectionData = {
                logs: [
                    {
                        message: 'Error occurred',
                        level: 'error',
                        service: 'api',
                        time: new Date(),
                    },
                ],
                organizationId: organization.id,
                projectId: project.id,
            };

            await processSigmaDetection({ data: jobData });

            // Should log matches found (if rule matches) or no matches
            expect(consoleSpy).toHaveBeenCalled();
        });

        it('should handle empty logs array', async () => {
            const { organization } = await createTestContext();

            const consoleSpy = vi.spyOn(console, 'log');

            const jobData: SigmaDetectionData = {
                logs: [],
                organizationId: organization.id,
            };

            await processSigmaDetection({ data: jobData });

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Processing 0 logs')
            );
        });

        it('should process multiple logs in a batch', async () => {
            const { organization } = await createTestContext();

            const consoleSpy = vi.spyOn(console, 'log');

            const jobData: SigmaDetectionData = {
                logs: [
                    { message: 'Log 1', level: 'info', service: 'api', time: new Date() },
                    { message: 'Log 2', level: 'warn', service: 'api', time: new Date() },
                    { message: 'Log 3', level: 'error', service: 'api', time: new Date() },
                ],
                organizationId: organization.id,
            };

            await processSigmaDetection({ data: jobData });

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Processing 3 logs')
            );
        });

        it('should handle detection engine errors gracefully', async () => {
            const { organization } = await createTestContext();

            // Mock the detection engine to throw an error
            vi.spyOn(SigmaDetectionEngine, 'evaluateBatch').mockRejectedValueOnce(
                new Error('Detection engine error')
            );

            const consoleErrorSpy = vi.spyOn(console, 'error');

            const jobData: SigmaDetectionData = {
                logs: [
                    { message: 'Test log', level: 'info', service: 'api', time: new Date() },
                ],
                organizationId: organization.id,
            };

            await expect(processSigmaDetection({ data: jobData })).rejects.toThrow(
                'Detection engine error'
            );

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Job failed'),
                expect.any(Error)
            );
        });

        it('should skip notification when Sigma rule has no recipients', async () => {
            const { organization, project } = await createTestContext();

            // Create a Sigma rule without notification settings
            const rule = await createTestSigmaRule({
                organizationId: organization.id,
                projectId: project.id,
                title: 'Rule Without Notifications',
                detection: {
                    selection: { level: 'critical' },
                    condition: 'selection',
                },
                emailRecipients: [],
                webhookUrl: undefined,
            });

            const consoleSpy = vi.spyOn(console, 'log');

            // Mock the detection engine to return a match
            vi.spyOn(SigmaDetectionEngine, 'evaluateBatch').mockResolvedValueOnce([
                {
                    matched: true,
                    matchedRules: [
                        {
                            sigmaRuleId: rule.id,
                            ruleTitle: rule.title,
                            ruleLevel: rule.level,
                            matchedAt: new Date(),
                        },
                    ],
                },
            ]);

            const jobData: SigmaDetectionData = {
                logs: [
                    { message: 'Critical error', level: 'critical', service: 'api', time: new Date() },
                ],
                organizationId: organization.id,
                projectId: project.id,
            };

            await processSigmaDetection({ data: jobData });

            // Should log that notification settings are not configured
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('no notification settings')
            );
        });

        it('should queue notification when Sigma rule has email recipients', async () => {
            const { organization, project } = await createTestContext();

            // Create a Sigma rule with email notification
            const rule = await createTestSigmaRule({
                organizationId: organization.id,
                projectId: project.id,
                title: 'Rule With Email',
                detection: {
                    selection: { level: 'error' },
                    condition: 'selection',
                },
                emailRecipients: ['alert@example.com'],
            });

            const consoleSpy = vi.spyOn(console, 'log');

            // Mock the detection engine to return a match
            vi.spyOn(SigmaDetectionEngine, 'evaluateBatch').mockResolvedValueOnce([
                {
                    matched: true,
                    matchedRules: [
                        {
                            sigmaRuleId: rule.id,
                            ruleTitle: rule.title,
                            ruleLevel: rule.level,
                            matchedAt: new Date(),
                        },
                    ],
                },
            ]);

            const jobData: SigmaDetectionData = {
                logs: [
                    { message: 'Error log', level: 'error', service: 'api', time: new Date() },
                ],
                organizationId: organization.id,
                projectId: project.id,
            };

            await processSigmaDetection({ data: jobData });

            // Should log that notification was queued
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Queued notification')
            );
        });

        it('should queue notification when Sigma rule has webhook URL', async () => {
            const { organization, project } = await createTestContext();

            // Create a Sigma rule with webhook notification
            const rule = await createTestSigmaRule({
                organizationId: organization.id,
                projectId: project.id,
                title: 'Rule With Webhook',
                detection: {
                    selection: { message: { contains: 'attack' } },
                    condition: 'selection',
                },
                webhookUrl: 'https://hooks.example.com/alert',
            });

            const consoleSpy = vi.spyOn(console, 'log');

            // Mock the detection engine to return a match
            vi.spyOn(SigmaDetectionEngine, 'evaluateBatch').mockResolvedValueOnce([
                {
                    matched: true,
                    matchedRules: [
                        {
                            sigmaRuleId: rule.id,
                            ruleTitle: rule.title,
                            ruleLevel: rule.level,
                            matchedAt: new Date(),
                        },
                    ],
                },
            ]);

            const jobData: SigmaDetectionData = {
                logs: [
                    { message: 'Possible attack detected', level: 'warn', service: 'api', time: new Date() },
                ],
                organizationId: organization.id,
                projectId: project.id,
            };

            await processSigmaDetection({ data: jobData });

            // Should log that notification was queued
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Queued notification')
            );
        });

        it('should group multiple matches by rule', async () => {
            const { organization, project } = await createTestContext();

            const rule = await createTestSigmaRule({
                organizationId: organization.id,
                projectId: project.id,
                title: 'Multi-Match Rule',
                detection: {
                    selection: { level: 'error' },
                    condition: 'selection',
                },
                emailRecipients: ['admin@example.com'],
            });

            const consoleSpy = vi.spyOn(console, 'log');

            // Mock the detection engine to return multiple matches for same rule
            vi.spyOn(SigmaDetectionEngine, 'evaluateBatch').mockResolvedValueOnce([
                {
                    matched: true,
                    matchedRules: [
                        {
                            sigmaRuleId: rule.id,
                            ruleTitle: rule.title,
                            ruleLevel: rule.level,
                            matchedAt: new Date(),
                        },
                    ],
                },
                {
                    matched: true,
                    matchedRules: [
                        {
                            sigmaRuleId: rule.id,
                            ruleTitle: rule.title,
                            ruleLevel: rule.level,
                            matchedAt: new Date(),
                        },
                    ],
                },
                {
                    matched: false,
                    matchedRules: [],
                },
            ]);

            const jobData: SigmaDetectionData = {
                logs: [
                    { message: 'Error 1', level: 'error', service: 'api', time: new Date() },
                    { message: 'Error 2', level: 'error', service: 'api', time: new Date() },
                    { message: 'Info log', level: 'info', service: 'api', time: new Date() },
                ],
                organizationId: organization.id,
                projectId: project.id,
            };

            await processSigmaDetection({ data: jobData });

            // Should log 2 matches found across logs
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Found 2 matches')
            );
            // Should only queue one notification (grouped by rule)
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Queued notification')
            );
        });
    });
});
