import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { SigmaService } from '../../../modules/sigma/service.js';
import { createTestContext } from '../../helpers/factories.js';

describe('SigmaService', () => {
    let sigmaService: SigmaService;

    beforeEach(async () => {
        sigmaService = new SigmaService();

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

    const validSigmaYaml = `
title: Test Sigma Rule
status: experimental
level: medium
logsource:
  category: application
  product: test
detection:
  selection:
    EventID: 1234
  condition: selection
description: A test Sigma rule for unit testing
author: Test Author
date: 2024/01/01
`;

    const complexSigmaYaml = `
title: Complex Detection Rule
status: stable
level: high
logsource:
  category: webserver
  product: nginx
detection:
  selection_method:
    http_method:
      - POST
      - PUT
  selection_path:
    request_path|contains:
      - '/admin'
      - '/api/internal'
  filter_safe:
    source_ip|startswith: '10.'
  condition: (selection_method and selection_path) and not filter_safe
description: Detects suspicious requests to admin endpoints
author: Security Team
date: 2024/06/15
tags:
  - attack.initial_access
  - attack.t1190
`;

    describe('importSigmaRule', () => {
        it('should import a valid Sigma rule', async () => {
            const { organization } = await createTestContext();

            const result = await sigmaService.importSigmaRule({
                yaml: validSigmaYaml,
                organizationId: organization.id,
            });

            expect(result.errors).toHaveLength(0);
            expect(result.sigmaRule).toBeDefined();
            expect(result.sigmaRule.title).toBe('Test Sigma Rule');
            expect(result.sigmaRule.level).toBe('medium');
            expect(result.sigmaRule.status).toBe('experimental');
            expect(result.sigmaRule.organizationId).toBe(organization.id);
        });

        it('should import rule with project scope', async () => {
            const { organization, project } = await createTestContext();

            const result = await sigmaService.importSigmaRule({
                yaml: validSigmaYaml,
                organizationId: organization.id,
                projectId: project.id,
            });

            expect(result.errors).toHaveLength(0);
            expect(result.sigmaRule.projectId).toBe(project.id);
        });

        it('should import rule with email recipients', async () => {
            const { organization } = await createTestContext();

            const result = await sigmaService.importSigmaRule({
                yaml: validSigmaYaml,
                organizationId: organization.id,
                emailRecipients: ['alert@example.com', 'security@example.com'],
            });

            expect(result.errors).toHaveLength(0);
            expect(result.sigmaRule.emailRecipients).toEqual([
                'alert@example.com',
                'security@example.com',
            ]);
        });

        it('should import rule with webhook URL', async () => {
            const { organization } = await createTestContext();

            const result = await sigmaService.importSigmaRule({
                yaml: validSigmaYaml,
                organizationId: organization.id,
                webhookUrl: 'https://hooks.slack.com/services/xxx',
            });

            expect(result.errors).toHaveLength(0);
            expect(result.sigmaRule.webhookUrl).toBe(
                'https://hooks.slack.com/services/xxx'
            );
        });

        it('should return errors for invalid YAML', async () => {
            const { organization } = await createTestContext();

            const result = await sigmaService.importSigmaRule({
                yaml: 'invalid: yaml: content:::',
                organizationId: organization.id,
            });

            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should return errors for missing required fields', async () => {
            const { organization } = await createTestContext();

            const invalidYaml = `
title: Missing Detection
status: experimental
level: medium
logsource:
  category: test
# Missing detection field
`;

            const result = await sigmaService.importSigmaRule({
                yaml: invalidYaml,
                organizationId: organization.id,
            });

            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should import complex detection patterns', async () => {
            const { organization } = await createTestContext();

            const result = await sigmaService.importSigmaRule({
                yaml: complexSigmaYaml,
                organizationId: organization.id,
            });

            expect(result.errors).toHaveLength(0);
            expect(result.sigmaRule.title).toBe('Complex Detection Rule');
            expect(result.sigmaRule.level).toBe('high');
            expect(result.sigmaRule.detection).toBeDefined();
        });

        it('should not create alert rule by default', async () => {
            const { organization } = await createTestContext();

            const result = await sigmaService.importSigmaRule({
                yaml: validSigmaYaml,
                organizationId: organization.id,
            });

            expect(result.alertRule).toBeNull();
        });

        it('should set conversionStatus to success for valid rules', async () => {
            const { organization } = await createTestContext();

            const result = await sigmaService.importSigmaRule({
                yaml: validSigmaYaml,
                organizationId: organization.id,
            });

            expect(result.sigmaRule.conversionStatus).toBe('success');
        });
    });

    describe('getSigmaRules', () => {
        it('should return empty array when no rules exist', async () => {
            const { organization } = await createTestContext();

            const rules = await sigmaService.getSigmaRules(organization.id);

            expect(rules).toEqual([]);
        });

        it('should return all rules for an organization', async () => {
            const { organization } = await createTestContext();

            // Import multiple rules
            await sigmaService.importSigmaRule({
                yaml: validSigmaYaml,
                organizationId: organization.id,
            });

            const rule2Yaml = validSigmaYaml.replace(
                'Test Sigma Rule',
                'Second Rule'
            );
            await sigmaService.importSigmaRule({
                yaml: rule2Yaml,
                organizationId: organization.id,
            });

            const rules = await sigmaService.getSigmaRules(organization.id);

            expect(rules).toHaveLength(2);
        });

        it('should not return rules from other organizations', async () => {
            const { organization: org1 } = await createTestContext();
            const { organization: org2 } = await createTestContext();

            await sigmaService.importSigmaRule({
                yaml: validSigmaYaml,
                organizationId: org1.id,
            });

            const rules = await sigmaService.getSigmaRules(org2.id);

            expect(rules).toHaveLength(0);
        });

        it('should return rules ordered by created_at desc', async () => {
            const { organization } = await createTestContext();

            await sigmaService.importSigmaRule({
                yaml: validSigmaYaml.replace('Test Sigma Rule', 'First Rule'),
                organizationId: organization.id,
            });

            await new Promise((resolve) => setTimeout(resolve, 10));

            await sigmaService.importSigmaRule({
                yaml: validSigmaYaml.replace('Test Sigma Rule', 'Second Rule'),
                organizationId: organization.id,
            });

            const rules = await sigmaService.getSigmaRules(organization.id);

            expect(rules[0].title).toBe('Second Rule');
            expect(rules[1].title).toBe('First Rule');
        });
    });

    describe('getSigmaRuleById', () => {
        it('should return a rule by ID', async () => {
            const { organization } = await createTestContext();

            const imported = await sigmaService.importSigmaRule({
                yaml: validSigmaYaml,
                organizationId: organization.id,
            });

            const rule = await sigmaService.getSigmaRuleById(
                imported.sigmaRule.id,
                organization.id
            );

            expect(rule).toBeDefined();
            expect(rule?.title).toBe('Test Sigma Rule');
        });

        it('should return null for non-existent rule', async () => {
            const { organization } = await createTestContext();

            const rule = await sigmaService.getSigmaRuleById(
                '00000000-0000-0000-0000-000000000000',
                organization.id
            );

            expect(rule).toBeNull();
        });

        it('should return null when accessing rule from different org', async () => {
            const { organization: org1 } = await createTestContext();
            const { organization: org2 } = await createTestContext();

            const imported = await sigmaService.importSigmaRule({
                yaml: validSigmaYaml,
                organizationId: org1.id,
            });

            const rule = await sigmaService.getSigmaRuleById(
                imported.sigmaRule.id,
                org2.id
            );

            expect(rule).toBeNull();
        });
    });

    describe('deleteSigmaRule', () => {
        it('should delete an existing rule', async () => {
            const { organization } = await createTestContext();

            const imported = await sigmaService.importSigmaRule({
                yaml: validSigmaYaml,
                organizationId: organization.id,
            });

            await sigmaService.deleteSigmaRule(
                imported.sigmaRule.id,
                organization.id
            );

            const rule = await sigmaService.getSigmaRuleById(
                imported.sigmaRule.id,
                organization.id
            );

            expect(rule).toBeNull();
        });

        it('should throw error for non-existent rule', async () => {
            const { organization } = await createTestContext();

            await expect(
                sigmaService.deleteSigmaRule(
                    '00000000-0000-0000-0000-000000000000',
                    organization.id
                )
            ).rejects.toThrow('Sigma rule not found');
        });

        it('should throw error when deleting rule from different org', async () => {
            const { organization: org1 } = await createTestContext();
            const { organization: org2 } = await createTestContext();

            const imported = await sigmaService.importSigmaRule({
                yaml: validSigmaYaml,
                organizationId: org1.id,
            });

            await expect(
                sigmaService.deleteSigmaRule(imported.sigmaRule.id, org2.id)
            ).rejects.toThrow('Sigma rule not found');
        });

        it('should not affect other rules when deleting', async () => {
            const { organization } = await createTestContext();

            const rule1 = await sigmaService.importSigmaRule({
                yaml: validSigmaYaml.replace('Test Sigma Rule', 'Rule 1'),
                organizationId: organization.id,
            });

            const rule2 = await sigmaService.importSigmaRule({
                yaml: validSigmaYaml.replace('Test Sigma Rule', 'Rule 2'),
                organizationId: organization.id,
            });

            await sigmaService.deleteSigmaRule(
                rule1.sigmaRule.id,
                organization.id
            );

            const remaining = await sigmaService.getSigmaRules(organization.id);

            expect(remaining).toHaveLength(1);
            expect(remaining[0].title).toBe('Rule 2');
        });
    });
});
