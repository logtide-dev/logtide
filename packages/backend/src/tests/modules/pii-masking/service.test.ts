import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { PiiMaskingService } from '../../../modules/pii-masking/service.js';
import { createTestContext } from '../../helpers/factories.js';
import type { LogInput } from '@logtide/shared';

describe('PiiMaskingService', () => {
    let service: PiiMaskingService;
    let organizationId: string;
    let projectId: string;

    beforeEach(async () => {
        service = new PiiMaskingService();

        await db.deleteFrom('organization_pii_salts').execute();
        await db.deleteFrom('pii_masking_rules').execute();
        await db.deleteFrom('logs').execute();
        await db.deleteFrom('api_keys').execute();
        await db.deleteFrom('organization_members').execute();
        await db.deleteFrom('projects').execute();
        await db.deleteFrom('organizations').execute();
        await db.deleteFrom('sessions').execute();
        await db.deleteFrom('users').execute();

        const ctx = await createTestContext();
        organizationId = ctx.organization.id;
        projectId = ctx.project.id;
    });

    afterEach(() => {
        service.invalidateCache(organizationId);
    });

    // =========================================================================
    // CRUD
    // =========================================================================

    describe('getRulesForOrg', () => {
        it('should return built-in rules when no DB rules exist', async () => {
            const rules = await service.getRulesForOrg(organizationId);

            // Should have built-in content rules + field rules
            const builtInRules = rules.filter((r) => r.isBuiltIn);
            expect(builtInRules.length).toBeGreaterThan(0);

            // Built-ins should be disabled by default
            for (const rule of builtInRules) {
                expect(rule.enabled).toBe(false);
            }
        });

        it('should merge DB rules with built-in defaults', async () => {
            // Create a DB rule that overrides a built-in
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email Override',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
            });

            const rules = await service.getRulesForOrg(organizationId);
            const emailRules = rules.filter((r) => r.name === 'email');

            // Should only have ONE email rule (DB override, not both)
            expect(emailRules.length).toBe(1);
            expect(emailRules[0].displayName).toBe('Email Override');
            expect(emailRules[0].action).toBe('redact');
        });

        it('should filter by projectId', async () => {
            // Create org-wide rule
            await service.createRule(organizationId, {
                name: 'org_rule',
                displayName: 'Org Rule',
                patternType: 'custom',
                regexPattern: '\\btest\\b',
                action: 'redact',
            });

            // Create project-specific rule
            await service.createRule(organizationId, {
                name: 'project_rule',
                displayName: 'Project Rule',
                patternType: 'custom',
                regexPattern: '\\bfoo\\b',
                action: 'redact',
                projectId,
            });

            // With projectId, should get both org-wide and project-specific
            const withProject = await service.getRulesForOrg(organizationId, projectId);
            const customRules = withProject.filter((r) => !r.isBuiltIn);
            expect(customRules.length).toBe(2);

            // Without projectId, should only get org-wide
            const withoutProject = await service.getRulesForOrg(organizationId);
            const customRulesNoProject = withoutProject.filter((r) => !r.isBuiltIn);
            expect(customRulesNoProject.length).toBe(1);
            expect(customRulesNoProject[0].name).toBe('org_rule');
        });
    });

    describe('createRule', () => {
        it('should create a custom rule', async () => {
            const rule = await service.createRule(organizationId, {
                name: 'my_custom',
                displayName: 'My Custom Rule',
                description: 'A test rule',
                patternType: 'custom',
                regexPattern: '\\bsecret\\b',
                action: 'redact',
                enabled: true,
                priority: 10,
            });

            expect(rule.id).toBeDefined();
            expect(rule.name).toBe('my_custom');
            expect(rule.organizationId).toBe(organizationId);
            expect(rule.action).toBe('redact');
            expect(rule.enabled).toBe(true);
            expect(rule.priority).toBe(10);
            expect(rule.isBuiltIn).toBe(false);
        });

        it('should validate regex for custom rules', async () => {
            // Build ReDoS pattern dynamically to avoid static analysis flagging the test itself
            const redosPattern = '(a' + '+)+$';
            await expect(
                service.createRule(organizationId, {
                    name: 'bad_regex',
                    displayName: 'Bad Regex',
                    patternType: 'custom',
                    regexPattern: redosPattern,
                    action: 'redact',
                })
            ).rejects.toThrow();
        });

        it('should not validate regex for builtin rules', async () => {
            // builtin rules skip regex validation
            const rule = await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email',
                patternType: 'builtin',
                action: 'mask',
            });

            expect(rule.name).toBe('email');
        });

        it('should use defaults for optional fields', async () => {
            const rule = await service.createRule(organizationId, {
                name: 'defaults_test',
                displayName: 'Defaults Test',
                patternType: 'custom',
                regexPattern: '\\btest\\b',
                action: 'mask',
            });

            expect(rule.enabled).toBe(true);
            expect(rule.priority).toBe(50);
        });

        it('should invalidate cache on create', async () => {
            // Warm cache
            await service.getRulesForOrg(organizationId);

            // Create rule
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
            });

            // maskLogBatch should now use the new rule (cache invalidated)
            const logs = [{ message: 'contact test@example.com please', service: 'svc', level: 'info' as const }];
            await service.maskLogBatch(logs, organizationId, projectId);
            expect(logs[0].message).toContain('[REDACTED_EMAIL]');
        });
    });

    describe('updateRule', () => {
        it('should update rule fields', async () => {
            const rule = await service.createRule(organizationId, {
                name: 'update_test',
                displayName: 'Before',
                patternType: 'custom',
                regexPattern: '\\btest\\b',
                action: 'mask',
                enabled: true,
            });

            const updated = await service.updateRule(rule.id, organizationId, {
                displayName: 'After',
                action: 'redact',
                enabled: false,
                priority: 99,
            });

            expect(updated.displayName).toBe('After');
            expect(updated.action).toBe('redact');
            expect(updated.enabled).toBe(false);
            expect(updated.priority).toBe(99);
        });

        it('should validate regex when updating custom rules', async () => {
            const rule = await service.createRule(organizationId, {
                name: 'custom_upd',
                displayName: 'Custom',
                patternType: 'custom',
                regexPattern: '\\btest\\b',
                action: 'mask',
            });

            const redosPattern = '(a' + '+)+$';
            await expect(
                service.updateRule(rule.id, organizationId, {
                    regexPattern: redosPattern,
                })
            ).rejects.toThrow();
        });

        it('should throw when updating non-existent rule', async () => {
            await expect(
                service.updateRule('00000000-0000-0000-0000-000000000000', organizationId, {
                    displayName: 'Nope',
                })
            ).rejects.toThrow();
        });
    });

    describe('deleteRule', () => {
        it('should delete an existing rule', async () => {
            const rule = await service.createRule(organizationId, {
                name: 'to_delete',
                displayName: 'Delete Me',
                patternType: 'custom',
                regexPattern: '\\bdelete\\b',
                action: 'redact',
            });

            await service.deleteRule(rule.id, organizationId);

            const rules = await service.getRulesForOrg(organizationId);
            const found = rules.find((r) => r.name === 'to_delete');
            expect(found).toBeUndefined();
        });

        it('should throw when deleting non-existent rule', async () => {
            await expect(
                service.deleteRule('00000000-0000-0000-0000-000000000000', organizationId)
            ).rejects.toThrow('Rule not found');
        });
    });

    // =========================================================================
    // Regex Validation
    // =========================================================================

    describe('validateRegex', () => {
        it('should accept valid regex', () => {
            expect(service.validateRegex('\\b[a-z]+\\b')).toEqual({ valid: true });
        });

        it('should reject pattern longer than 500 chars', () => {
            const long = 'a'.repeat(501);
            const result = service.validateRegex(long);
            expect(result.valid).toBe(false);
            if (!result.valid) expect(result.error).toContain('too long');
        });

        it('should reject lookahead assertions', () => {
            const result = service.validateRegex('(?=foo)bar');
            expect(result.valid).toBe(false);
            if (!result.valid) expect(result.error).toContain('Lookahead');
        });

        it('should reject lookbehind assertions', () => {
            const result = service.validateRegex('(?<=foo)bar');
            expect(result.valid).toBe(false);
            if (!result.valid) expect(result.error).toContain('Lookahead');
        });

        it('should reject negative lookahead', () => {
            const result = service.validateRegex('(?!foo)bar');
            expect(result.valid).toBe(false);
            if (!result.valid) expect(result.error).toContain('Lookahead');
        });

        it('should reject quantifier range > 100', () => {
            const result = service.validateRegex('a{101}');
            expect(result.valid).toBe(false);
            if (!result.valid) expect(result.error).toContain('Quantifier range');
        });

        it('should accept quantifier range <= 100', () => {
            expect(service.validateRegex('a{1,100}')).toEqual({ valid: true });
        });

        it('should reject ReDoS vulnerable patterns', () => {
            const redosPattern = '(a' + '+)+$';
            const result = service.validateRegex(redosPattern);
            expect(result.valid).toBe(false);
            if (!result.valid) expect(result.error).toContain('ReDoS');
        });

        it('should reject invalid regex syntax', () => {
            const result = service.validateRegex('[invalid');
            expect(result.valid).toBe(false);
        });

        it('should accept unbounded upper quantifier', () => {
            // {3,} is safe
            expect(service.validateRegex('a{3,}')).toEqual({ valid: true });
        });
    });

    // =========================================================================
    // Masking Engine
    // =========================================================================

    describe('maskLogBatch', () => {
        it('should do nothing when no rules are enabled', async () => {
            const logs = [
                { message: 'email: test@example.com', service: 'svc', level: 'info' as const },
            ];

            await service.maskLogBatch(logs, organizationId, projectId);
            expect(logs[0].message).toBe('email: test@example.com');
        });

        it('should mask emails with content rule', async () => {
            // Enable built-in email rule
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email',
                patternType: 'builtin',
                action: 'mask',
                enabled: true,
            });

            const logs = [
                { message: 'Contact user@example.com for help', service: 'svc', level: 'info' as const },
            ];

            await service.maskLogBatch(logs, organizationId, projectId);
            expect(logs[0].message).toContain('u***@example.com');
            expect(logs[0].message).not.toContain('user@example.com');
        });

        it('should redact emails when action is redact', async () => {
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
            });

            const logs = [
                { message: 'Contact user@example.com', service: 'svc', level: 'info' as const },
            ];

            await service.maskLogBatch(logs, organizationId, projectId);
            expect(logs[0].message).toContain('[REDACTED_EMAIL]');
        });

        it('should hash emails when action is hash', async () => {
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email',
                patternType: 'builtin',
                action: 'hash',
                enabled: true,
            });

            const logs = [
                { message: 'Contact user@example.com', service: 'svc', level: 'info' as const },
            ];

            await service.maskLogBatch(logs, organizationId, projectId);
            expect(logs[0].message).toMatch(/\[HASH:[a-f0-9]{16}\]/);
        });

        it('should mask credit card numbers', async () => {
            await service.createRule(organizationId, {
                name: 'credit_card',
                displayName: 'Credit Card',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
            });

            const logs = [
                { message: 'Card: 4111-1111-1111-1111', service: 'svc', level: 'info' as const },
            ];

            await service.maskLogBatch(logs, organizationId, projectId);
            expect(logs[0].message).toContain('[REDACTED_CC]');
        });

        it('should mask a credit card in an otherwise pure-alphanumeric string', async () => {
            // Regression: maskText used to early-exit on /^[a-zA-Z0-9 _]+$/ strings,
            // leaving separator-less card numbers unmasked.
            await service.createRule(organizationId, {
                name: 'credit_card',
                displayName: 'Credit Card',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
            });

            const logs = [
                { message: 'card 4111111111111111', service: 'svc', level: 'info' as const },
            ];

            await service.maskLogBatch(logs, organizationId, projectId);
            expect(logs[0].message).not.toContain('4111111111111111');
            expect(logs[0].message).toContain('[REDACTED_CC]');
        });

        it('should mask SSN patterns', async () => {
            await service.createRule(organizationId, {
                name: 'ssn',
                displayName: 'SSN',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
            });

            const logs = [
                { message: 'SSN is 123-45-6789', service: 'svc', level: 'info' as const },
            ];

            await service.maskLogBatch(logs, organizationId, projectId);
            expect(logs[0].message).toContain('[REDACTED_SSN]');
        });

        it('should mask IP addresses', async () => {
            await service.createRule(organizationId, {
                name: 'ip_address',
                displayName: 'IP',
                patternType: 'builtin',
                action: 'mask',
                enabled: true,
            });

            const logs = [
                { message: 'Request from 192.168.1.100', service: 'svc', level: 'info' as const },
            ];

            await service.maskLogBatch(logs, organizationId, projectId);
            expect(logs[0].message).toContain('192.168.***.***');
        });

        it('should mask API keys', async () => {
            await service.createRule(organizationId, {
                name: 'api_key',
                displayName: 'API Key',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
            });

            const logs = [
                { message: 'api_key: abcdefghijklmnopqrstuvwxyz', service: 'svc', level: 'info' as const },
            ];

            await service.maskLogBatch(logs, organizationId, projectId);
            expect(logs[0].message).toContain('[REDACTED_KEY]');
        });

        it('should mask metadata field names', async () => {
            await service.createRule(organizationId, {
                name: 'sensitive_fields',
                displayName: 'Sensitive Fields',
                patternType: 'field_name',
                action: 'redact',
                enabled: true,
            });

            const logs = [
                {
                    message: 'login attempt',
                    service: 'svc',
                    level: 'info' as const,
                    metadata: { password: 'secret123', username: 'john' },
                },
            ];

            await service.maskLogBatch(logs, organizationId, projectId);
            const meta = logs[0].metadata as Record<string, unknown>;
            expect(meta.password).toBe('[REDACTED]');
            expect(meta.username).toBe('john');
        });

        it('should mask nested metadata fields', async () => {
            await service.createRule(organizationId, {
                name: 'sensitive_fields',
                displayName: 'Sensitive Fields',
                patternType: 'field_name',
                action: 'redact',
                enabled: true,
            });

            const logs = [
                {
                    message: 'test',
                    service: 'svc',
                    level: 'info' as const,
                    metadata: {
                        user: {
                            token: 'abc123',
                            name: 'Jane',
                        },
                    },
                },
            ];

            await service.maskLogBatch(logs, organizationId, projectId);
            const meta = logs[0].metadata as any;
            expect(meta.user.token).toBe('[REDACTED]');
            expect(meta.user.name).toBe('Jane');
        });

        it('should mask content in metadata string values', async () => {
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
            });

            const logs = [
                {
                    message: 'test',
                    service: 'svc',
                    level: 'info' as const,
                    metadata: {
                        description: 'Sent to user@example.com',
                    },
                },
            ];

            await service.maskLogBatch(logs, organizationId, projectId);
            const meta = logs[0].metadata as any;
            expect(meta.description).toContain('[REDACTED_EMAIL]');
        });

        it('should mask arrays in metadata', async () => {
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
            });

            const logs = [
                {
                    message: 'test',
                    service: 'svc',
                    level: 'info' as const,
                    metadata: {
                        recipients: ['admin@test.com', 'user@test.com'],
                    },
                },
            ];

            await service.maskLogBatch(logs, organizationId, projectId);
            const meta = logs[0].metadata as any;
            expect(meta.recipients[0]).toContain('[REDACTED_EMAIL]');
            expect(meta.recipients[1]).toContain('[REDACTED_EMAIL]');
        });

        it('should handle multiple logs in a batch', async () => {
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
            });

            const logs = [
                { message: 'a@test.com sent', service: 'svc', level: 'info' as const },
                { message: 'no pii here', service: 'svc', level: 'info' as const },
                { message: 'b@test.com received', service: 'svc', level: 'info' as const },
            ];

            await service.maskLogBatch(logs, organizationId, projectId);
            expect(logs[0].message).toContain('[REDACTED_EMAIL]');
            expect(logs[1].message).toBe('no pii here');
            expect(logs[2].message).toContain('[REDACTED_EMAIL]');
        });

        it('should skip short strings (optimization)', async () => {
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
            });

            const logs = [
                { message: 'hello', service: 'svc', level: 'info' as const }, // < 6 chars
            ];

            await service.maskLogBatch(logs, organizationId, projectId);
            expect(logs[0].message).toBe('hello');
        });

        it('should handle custom content rules', async () => {
            await service.createRule(organizationId, {
                name: 'custom_ssn',
                displayName: 'Custom SSN',
                patternType: 'custom',
                regexPattern: 'SSN-\\d{3}-\\d{2}-\\d{4}',
                action: 'redact',
                enabled: true,
            });

            const logs = [
                { message: 'Found SSN-123-45-6789 in data', service: 'svc', level: 'info' as const },
            ];

            await service.maskLogBatch(logs, organizationId, projectId);
            expect(logs[0].message).toContain('[REDACTED_CUSTOM_SSN]');
        });

        it('should handle custom field-name rules', async () => {
            await service.createRule(organizationId, {
                name: 'custom_fields',
                displayName: 'Custom Sensitive Fields',
                patternType: 'field_name',
                fieldNames: ['my_secret', 'internal_key'],
                action: 'redact',
                enabled: true,
            });

            const logs = [
                {
                    message: 'test',
                    service: 'svc',
                    level: 'info' as const,
                    metadata: { my_secret: 'hide-this', other: 'keep-this' },
                },
            ];

            await service.maskLogBatch(logs, organizationId, projectId);
            const meta = logs[0].metadata as any;
            expect(meta.my_secret).toContain('[REDACTED_CUSTOM_FIELDS]');
            expect(meta.other).toBe('keep-this');
        });

        it('should handle non-string field values with field rules', async () => {
            await service.createRule(organizationId, {
                name: 'sensitive_fields',
                displayName: 'Sensitive Fields',
                patternType: 'field_name',
                action: 'redact',
                enabled: true,
            });

            const logs = [
                {
                    message: 'test',
                    service: 'svc',
                    level: 'info' as const,
                    metadata: { token: 12345 },
                },
            ];

            await service.maskLogBatch(logs, organizationId, projectId);
            const meta = logs[0].metadata as any;
            expect(meta.token).toBe('[REDACTED]');
        });

        it('should not mask null/undefined field values', async () => {
            await service.createRule(organizationId, {
                name: 'sensitive_fields',
                displayName: 'Sensitive Fields',
                patternType: 'field_name',
                action: 'redact',
                enabled: true,
            });

            const logs = [
                {
                    message: 'test',
                    service: 'svc',
                    level: 'info' as const,
                    metadata: { password: null },
                },
            ];

            await service.maskLogBatch(logs, organizationId, projectId);
            const meta = logs[0].metadata as any;
            expect(meta.password).toBeNull();
        });

        it('should handle objects inside arrays in metadata', async () => {
            await service.createRule(organizationId, {
                name: 'sensitive_fields',
                displayName: 'Sensitive Fields',
                patternType: 'field_name',
                action: 'redact',
                enabled: true,
            });

            const logs = [
                {
                    message: 'test',
                    service: 'svc',
                    level: 'info' as const,
                    metadata: {
                        users: [
                            { name: 'Alice', password: 'abc' },
                            { name: 'Bob', password: 'def' },
                        ],
                    },
                },
            ];

            await service.maskLogBatch(logs, organizationId, projectId);
            const meta = logs[0].metadata as any;
            expect(meta.users[0].password).toBe('[REDACTED]');
            expect(meta.users[1].password).toBe('[REDACTED]');
            expect(meta.users[0].name).toBe('Alice');
        });

        it('returns empty array when all records mask successfully', async () => {
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
            });

            const logs: LogInput[] = [
                { time: new Date(), service: 'api', level: 'info', message: 'user email is test@example.com' },
            ];
            const failed = await service.maskLogBatch(logs, organizationId, projectId);
            expect(failed).toEqual([]);
        });

        it('returns the index of a record whose masking throws, leaving others masked', async () => {
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
            });

            const logs: LogInput[] = [
                { time: new Date(), service: 'api', level: 'info', message: 'first test@example.com' },
                { time: new Date(), service: 'api', level: 'info', message: 'second test@example.com' },
                { time: new Date(), service: 'api', level: 'info', message: 'third test@example.com' },
            ];
            const realMaskText = (service as any).maskText.bind(service);
            const spy = vi.spyOn(service as any, 'maskText').mockImplementation((text: string, ruleSet: unknown) => {
                if (typeof text === 'string' && text.startsWith('second')) {
                    throw new Error('boom');
                }
                return realMaskText(text, ruleSet);
            });
            try {
                const failed = await service.maskLogBatch(logs, organizationId, projectId);
                expect(failed).toEqual([1]);
                expect(logs[0].message).not.toContain('test@example.com');
                expect(logs[2].message).not.toContain('test@example.com');
            } finally {
                spy.mockRestore();
            }
        });

        it('fails the whole batch when rule compilation fails', async () => {
            const logs: LogInput[] = [
                { time: new Date(), service: 'api', level: 'info', message: 'a' },
                { time: new Date(), service: 'api', level: 'info', message: 'b' },
            ];
            const spy = vi.spyOn(service as any, 'getCompiledRules').mockRejectedValue(new Error('db down'));
            try {
                const failed = await service.maskLogBatch(logs, organizationId, projectId);
                expect(failed).toEqual([0, 1]);
            } finally {
                spy.mockRestore();
            }
        });
    });

    describe('testMasking', () => {
        it('should return masked message and fields list', async () => {
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
            });

            const result = await service.testMasking(organizationId, projectId, {
                message: 'Email: user@test.com',
            });

            expect(result.message).toContain('[REDACTED_EMAIL]');
            expect(result.maskedFields).toContain('message');
        });

        it('should return masked metadata with field paths', async () => {
            await service.createRule(organizationId, {
                name: 'sensitive_fields',
                displayName: 'Sensitive Fields',
                patternType: 'field_name',
                action: 'redact',
                enabled: true,
            });

            const result = await service.testMasking(organizationId, projectId, {
                metadata: { password: 'secret', nested: { token: 'abc' } },
            });

            expect(result.metadata).toBeDefined();
            expect((result.metadata as any).password).toBe('[REDACTED]');
            expect((result.metadata as any).nested.token).toBe('[REDACTED]');
            expect(result.maskedFields).toContain('password');
            expect(result.maskedFields).toContain('nested.token');
        });

        it('should not modify original input (deep clone)', async () => {
            await service.createRule(organizationId, {
                name: 'sensitive_fields',
                displayName: 'Sensitive Fields',
                patternType: 'field_name',
                action: 'redact',
                enabled: true,
            });

            const input = { metadata: { password: 'original' } };
            await service.testMasking(organizationId, projectId, input);
            expect(input.metadata.password).toBe('original');
        });

        it('should handle undefined projectId', async () => {
            const result = await service.testMasking(organizationId, undefined, {
                message: 'test',
            });

            expect(result.message).toBe('test');
            expect(result.maskedFields).toEqual([]);
        });

        it('should handle message without PII', async () => {
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
            });

            const result = await service.testMasking(organizationId, projectId, {
                message: 'just a normal log message',
            });

            expect(result.message).toBe('just a normal log message');
            expect(result.maskedFields).toEqual([]);
        });
    });

    // =========================================================================
    // Caching
    // =========================================================================

    describe('caching', () => {
        it('should cache compiled rules', async () => {
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
            });

            // First call compiles rules
            const logs1 = [{ message: 'test@example.com found', service: 'svc', level: 'info' as const }];
            await service.maskLogBatch(logs1, organizationId, projectId);
            expect(logs1[0].message).toContain('[REDACTED_EMAIL]');

            // Second call should use cache (same result)
            const logs2 = [{ message: 'other@example.com found', service: 'svc', level: 'info' as const }];
            await service.maskLogBatch(logs2, organizationId, projectId);
            expect(logs2[0].message).toContain('[REDACTED_EMAIL]');
        });

        it('should invalidate cache per org', async () => {
            service.invalidateCache(organizationId);
            // After invalidation, re-compile is expected
            const logs = [{ message: 'no rules', service: 'svc', level: 'info' as const }];
            await service.maskLogBatch(logs, organizationId, projectId);
            expect(logs[0].message).toBe('no rules');
        });
    });

    // =========================================================================
    // Salt management
    // =========================================================================

    describe('salt management', () => {
        it('should create salt on first hash', async () => {
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email',
                patternType: 'builtin',
                action: 'hash',
                enabled: true,
            });

            const logs = [{ message: 'user@example.com in log', service: 'svc', level: 'info' as const }];
            await service.maskLogBatch(logs, organizationId, projectId);
            expect(logs[0].message).toMatch(/\[HASH:[a-f0-9]{16}\]/);

            // Verify salt was created
            const salt = await db
                .selectFrom('organization_pii_salts')
                .select('salt')
                .where('organization_id', '=', organizationId)
                .executeTakeFirst();
            expect(salt).toBeDefined();
        });

        it('should reuse existing salt', async () => {
            // Pre-create salt
            await db
                .insertInto('organization_pii_salts')
                .values({ organization_id: organizationId, salt: 'fixed-salt' })
                .execute();

            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email',
                patternType: 'builtin',
                action: 'hash',
                enabled: true,
            });

            const logs1 = [{ message: 'user@example.com in log', service: 'svc', level: 'info' as const }];
            await service.maskLogBatch(logs1, organizationId, projectId);

            service.invalidateCache(organizationId);

            const logs2 = [{ message: 'user@example.com in log', service: 'svc', level: 'info' as const }];
            await service.maskLogBatch(logs2, organizationId, projectId);

            // Same input + same salt = same hash
            expect(logs1[0].message).toBe(logs2[0].message);
        });
    });

    // =========================================================================
    // Project override
    // =========================================================================

    describe('project-level overrides', () => {
        it('should let project rule override org rule with same name', async () => {
            // Org-level: mask emails
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email - Org',
                patternType: 'builtin',
                action: 'mask',
                enabled: true,
            });

            // Project-level: redact emails (override)
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email - Project',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
                projectId,
            });

            const logs = [{ message: 'test@example.com found', service: 'svc', level: 'info' as const }];
            await service.maskLogBatch(logs, organizationId, projectId);
            // Project override uses redact
            expect(logs[0].message).toContain('[REDACTED_EMAIL]');
        });
    });

    // =========================================================================
    // Edge cases
    // =========================================================================

    describe('edge cases', () => {
        it('should handle empty log batch', async () => {
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
            });

            const logs: any[] = [];
            const failed = await service.maskLogBatch(logs, organizationId, projectId);
            expect(logs.length).toBe(0);
            expect(failed).toEqual([]);
        });

        it('should handle log with no message', async () => {
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
            });

            const logs = [{ message: '', service: 'svc', level: 'info' as const }];
            await service.maskLogBatch(logs, organizationId, projectId);
            expect(logs[0].message).toBe('');
        });

        it('should skip custom rules with invalid regex at compile time', async () => {
            // Insert a rule with regex that is technically invalid when compiled
            // (by directly inserting into DB to bypass validation)
            await db
                .insertInto('pii_masking_rules')
                .values({
                    organization_id: organizationId,
                    name: 'bad_custom',
                    display_name: 'Bad Custom',
                    pattern_type: 'custom',
                    regex_pattern: '[invalid',
                    action: 'redact',
                    enabled: true,
                    priority: 50,
                })
                .execute();

            // Should not throw - just skip the bad rule
            const logs = [{ message: 'test message here', service: 'svc', level: 'info' as const }];
            await service.maskLogBatch(logs, organizationId, projectId);
            // Message should be unchanged (bad rule skipped)
            expect(logs[0].message).toBe('test message here');
        });
    });

    // =========================================================================
    // maskSpanBatch (trace span attributes)
    // =========================================================================

    describe('maskSpanBatch', () => {
        async function enableBodyMaskingRules() {
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email',
                patternType: 'builtin',
                action: 'mask',
                enabled: true,
            });
            await service.createRule(organizationId, {
                name: 'sensitive_fields',
                displayName: 'Sensitive Fields',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
            });
        }

        it('does nothing when no rules are enabled', async () => {
            const spans = [{ attributes: { 'http.request_body': '{"password":"secret123"}' } }];
            const failed = await service.maskSpanBatch(spans, organizationId, projectId);
            expect(failed).toEqual([]);
            expect(spans[0].attributes['http.request_body']).toBe('{"password":"secret123"}');
        });

        it('deep-masks credentials inside a stringified JSON request body', async () => {
            await enableBodyMaskingRules();

            const spans = [
                {
                    attributes: {
                        'http.method': 'POST',
                        'http.request_body':
                            '{"email":"giuseppe@solture.it","password":"Polliog80!"}',
                    },
                },
            ];

            const failed = await service.maskSpanBatch(spans, organizationId, projectId);
            expect(failed).toEqual([]);

            const body = spans[0].attributes['http.request_body'] as string;
            // Credentials gone
            expect(body).not.toContain('Polliog80!');
            expect(body).not.toContain('giuseppe@solture.it');
            // password redacted by field rule, structure preserved (still valid JSON)
            const parsed = JSON.parse(body);
            expect(parsed.password).toBe('[REDACTED]');
            expect(parsed.email).not.toContain('giuseppe@solture.it');
            // untouched attribute survives
            expect(spans[0].attributes['http.method']).toBe('POST');
        });

        it('redacts a body attribute that is not parseable JSON', async () => {
            await enableBodyMaskingRules();

            const spans = [{ attributes: { 'http.response_body': 'token=abc.def.ghi raw text' } }];
            await service.maskSpanBatch(spans, organizationId, projectId);
            expect(spans[0].attributes['http.response_body']).toBe('[REDACTED]');
        });

        it('masks IPs and emails in plain attributes via content rules', async () => {
            await service.createRule(organizationId, {
                name: 'ip_address',
                displayName: 'IP',
                patternType: 'builtin',
                action: 'redact',
                enabled: true,
            });
            await service.createRule(organizationId, {
                name: 'email',
                displayName: 'Email',
                patternType: 'builtin',
                action: 'mask',
                enabled: true,
            });

            const spans = [
                { attributes: { 'net.peer.ip': '10.0.1.16', 'enduser.id': 'a@b.com' } },
            ];
            await service.maskSpanBatch(spans, organizationId, projectId);
            expect(spans[0].attributes['net.peer.ip']).not.toBe('10.0.1.16');
            expect(spans[0].attributes['enduser.id']).not.toBe('a@b.com');
        });

        it('masks event and link attributes too', async () => {
            await enableBodyMaskingRules();

            const spans = [
                {
                    attributes: {},
                    events: [{ name: 'login', attributes: { password: 'hunter2' } }],
                    links: [{ attributes: { 'http.request_body': '{"token":"xyz"}' } }],
                },
            ];
            await service.maskSpanBatch(spans, organizationId, projectId);
            expect(spans[0].events[0].attributes.password).toBe('[REDACTED]');
            expect(spans[0].links[0].attributes['http.request_body'] as string).not.toContain('xyz');
        });

        it('masks resource attributes', async () => {
            await enableBodyMaskingRules();
            const spans = [{ resourceAttributes: { password: 'p' } }];
            await service.maskSpanBatch(spans, organizationId, projectId);
            expect(spans[0].resourceAttributes.password).toBe('[REDACTED]');
        });
    });
});
