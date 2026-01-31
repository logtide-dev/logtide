import { describe, it, expect } from 'vitest';
import { DETECTION_PACKS, getPackById, getPackIds } from '../../../modules/detection-packs/pack-definitions.js';

describe('Detection Pack Definitions', () => {
    describe('DETECTION_PACKS', () => {
        it('should contain expected packs', () => {
            expect(DETECTION_PACKS.length).toBeGreaterThan(0);

            const packIds = DETECTION_PACKS.map((p) => p.id);
            expect(packIds).toContain('startup-reliability');
            expect(packIds).toContain('auth-security');
            expect(packIds).toContain('database-health');
            expect(packIds).toContain('payment-billing');
        });

        it('should have valid structure for all packs', () => {
            for (const pack of DETECTION_PACKS) {
                // Required fields
                expect(pack.id).toBeDefined();
                expect(typeof pack.id).toBe('string');
                expect(pack.name).toBeDefined();
                expect(typeof pack.name).toBe('string');
                expect(pack.description).toBeDefined();
                expect(typeof pack.description).toBe('string');
                expect(pack.category).toBeDefined();
                expect(['reliability', 'security', 'database', 'business']).toContain(pack.category);
                expect(pack.icon).toBeDefined();
                expect(pack.rules).toBeDefined();
                expect(Array.isArray(pack.rules)).toBe(true);
                expect(pack.rules.length).toBeGreaterThan(0);
            }
        });

        it('should have valid rules in each pack', () => {
            for (const pack of DETECTION_PACKS) {
                for (const rule of pack.rules) {
                    // Required fields for Sigma rules
                    expect(rule.id).toBeDefined();
                    expect(typeof rule.id).toBe('string');
                    expect(rule.name).toBeDefined();
                    expect(typeof rule.name).toBe('string');
                    expect(rule.description).toBeDefined();
                    expect(rule.logsource).toBeDefined();
                    expect(rule.detection).toBeDefined();
                    expect(rule.detection.condition).toBeDefined();
                    expect(rule.level).toBeDefined();
                    expect(['informational', 'low', 'medium', 'high', 'critical']).toContain(rule.level);
                    expect(rule.status).toBeDefined();
                    expect(['experimental', 'test', 'stable', 'deprecated', 'unsupported']).toContain(rule.status);
                }
            }
        });

        it('should have unique rule IDs within each pack', () => {
            for (const pack of DETECTION_PACKS) {
                const ruleIds = pack.rules.map((r) => r.id);
                const uniqueIds = new Set(ruleIds);
                expect(ruleIds.length).toBe(uniqueIds.size);
            }
        });

        it('should have unique pack IDs', () => {
            const packIds = DETECTION_PACKS.map((p) => p.id);
            const uniqueIds = new Set(packIds);
            expect(packIds.length).toBe(uniqueIds.size);
        });
    });

    describe('getPackById', () => {
        it('should return pack for valid ID', () => {
            const pack = getPackById('startup-reliability');

            expect(pack).toBeDefined();
            expect(pack?.id).toBe('startup-reliability');
            expect(pack?.name).toBe('Startup Reliability Pack');
        });

        it('should return undefined for invalid ID', () => {
            const pack = getPackById('non-existent-pack');

            expect(pack).toBeUndefined();
        });

        it('should return correct pack for each known ID', () => {
            const expectedPacks = [
                { id: 'startup-reliability', name: 'Startup Reliability Pack' },
                { id: 'auth-security', name: 'Auth & Security Pack' },
                { id: 'database-health', name: 'Database Health Pack' },
                { id: 'payment-billing', name: 'Payment & Billing Pack' },
            ];

            for (const expected of expectedPacks) {
                const pack = getPackById(expected.id);
                expect(pack).toBeDefined();
                expect(pack?.name).toBe(expected.name);
            }
        });

        it('should return undefined for empty string', () => {
            const pack = getPackById('');
            expect(pack).toBeUndefined();
        });
    });

    describe('getPackIds', () => {
        it('should return all pack IDs', () => {
            const ids = getPackIds();

            expect(ids).toBeDefined();
            expect(Array.isArray(ids)).toBe(true);
            expect(ids.length).toBe(DETECTION_PACKS.length);
        });

        it('should contain expected IDs', () => {
            const ids = getPackIds();

            expect(ids).toContain('startup-reliability');
            expect(ids).toContain('auth-security');
            expect(ids).toContain('database-health');
            expect(ids).toContain('payment-billing');
        });

        it('should return unique IDs', () => {
            const ids = getPackIds();
            const uniqueIds = new Set(ids);

            expect(ids.length).toBe(uniqueIds.size);
        });
    });

    describe('Startup Reliability Pack', () => {
        it('should have expected rules', () => {
            const pack = getPackById('startup-reliability');
            expect(pack).toBeDefined();

            const ruleIds = pack!.rules.map((r) => r.id);
            expect(ruleIds).toContain('high-error-rate');
            expect(ruleIds).toContain('critical-errors');
            expect(ruleIds).toContain('oom-crashes');
            expect(ruleIds).toContain('unhandled-exceptions');
            expect(ruleIds).toContain('service-crash');
        });

        it('should have correct detection patterns for OOM', () => {
            const pack = getPackById('startup-reliability');
            const oomRule = pack!.rules.find((r) => r.id === 'oom-crashes');

            expect(oomRule).toBeDefined();
            expect(oomRule?.level).toBe('critical');
            expect(oomRule?.detection.selection['message|contains']).toBeDefined();
            expect(oomRule?.detection.selection['message|contains']).toContain('out of memory');
            expect(oomRule?.detection.selection['message|contains']).toContain('OutOfMemory');
        });
    });

    describe('Auth Security Pack', () => {
        it('should have expected rules', () => {
            const pack = getPackById('auth-security');
            expect(pack).toBeDefined();

            const ruleIds = pack!.rules.map((r) => r.id);
            expect(ruleIds).toContain('failed-login-attempts');
            expect(ruleIds).toContain('brute-force-detection');
            expect(ruleIds).toContain('suspicious-user-agent');
            expect(ruleIds).toContain('privilege-escalation');
            expect(ruleIds).toContain('session-hijacking');
        });

        it('should have MITRE ATT&CK tags', () => {
            const pack = getPackById('auth-security');
            const bruteForceRule = pack!.rules.find((r) => r.id === 'brute-force-detection');

            expect(bruteForceRule?.tags).toBeDefined();
            expect(bruteForceRule?.tags).toContain('attack.credential_access');
            expect(bruteForceRule?.tags?.some((t) => t.match(/attack\.t\d+/))).toBe(true);
        });
    });

    describe('Database Health Pack', () => {
        it('should have expected rules', () => {
            const pack = getPackById('database-health');
            expect(pack).toBeDefined();

            const ruleIds = pack!.rules.map((r) => r.id);
            expect(ruleIds).toContain('slow-query-detection');
            expect(ruleIds).toContain('connection-pool-exhaustion');
            expect(ruleIds).toContain('deadlock-detection');
            expect(ruleIds).toContain('replication-issues');
            expect(ruleIds).toContain('sql-injection-attempt');
        });

        it('should have critical level for SQL injection', () => {
            const pack = getPackById('database-health');
            const sqlInjectionRule = pack!.rules.find((r) => r.id === 'sql-injection-attempt');

            expect(sqlInjectionRule?.level).toBe('critical');
        });
    });

    describe('Payment Billing Pack', () => {
        it('should have expected rules', () => {
            const pack = getPackById('payment-billing');
            expect(pack).toBeDefined();

            const ruleIds = pack!.rules.map((r) => r.id);
            expect(ruleIds).toContain('payment-failure');
            expect(ruleIds).toContain('webhook-failure');
            expect(ruleIds).toContain('fraud-indicators');
            expect(ruleIds).toContain('chargeback-refund');
            expect(ruleIds).toContain('payment-gateway-error');
        });

        it('should have critical level for fraud detection', () => {
            const pack = getPackById('payment-billing');
            const fraudRule = pack!.rules.find((r) => r.id === 'fraud-indicators');

            expect(fraudRule?.level).toBe('critical');
        });
    });
});
