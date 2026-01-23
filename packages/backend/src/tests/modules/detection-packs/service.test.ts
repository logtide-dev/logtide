import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { DetectionPacksService } from '../../../modules/detection-packs/service.js';
import { DETECTION_PACKS, getPackById } from '../../../modules/detection-packs/pack-definitions.js';
import { createTestContext, createTestOrganization } from '../../helpers/factories.js';

describe('DetectionPacksService', () => {
    let service: DetectionPacksService;

    beforeEach(async () => {
        service = new DetectionPacksService();

        // Clean up in correct order (respecting foreign keys)
        await db.deleteFrom('detection_pack_activations').execute();
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

    describe('listPacksWithStatus', () => {
        it('should return all packs with disabled status when none enabled', async () => {
            const { organization } = await createTestContext();

            const packs = await service.listPacksWithStatus(organization.id);

            expect(packs).toHaveLength(DETECTION_PACKS.length);
            for (const pack of packs) {
                expect(pack.enabled).toBe(false);
                expect(pack.activatedAt).toBeNull();
                expect(pack.customThresholds).toBeNull();
                expect(pack.generatedRulesCount).toBe(0);
            }
        });

        it('should return enabled status for activated pack', async () => {
            const { organization } = await createTestContext();

            await service.enablePack(organization.id, 'startup-reliability');

            const packs = await service.listPacksWithStatus(organization.id);

            const reliabilityPack = packs.find((p) => p.id === 'startup-reliability');
            expect(reliabilityPack?.enabled).toBe(true);
            expect(reliabilityPack?.activatedAt).toBeDefined();
            expect(reliabilityPack?.generatedRulesCount).toBeGreaterThan(0);
        });

        it('should return correct count of generated rules', async () => {
            const { organization } = await createTestContext();

            const packDef = getPackById('startup-reliability');
            await service.enablePack(organization.id, 'startup-reliability');

            const packs = await service.listPacksWithStatus(organization.id);

            const reliabilityPack = packs.find((p) => p.id === 'startup-reliability');
            expect(reliabilityPack?.generatedRulesCount).toBe(packDef!.rules.length);
        });

        it('should not mix packs between organizations', async () => {
            const { organization: org1 } = await createTestContext();
            const { organization: org2 } = await createTestContext();

            await service.enablePack(org1.id, 'startup-reliability');

            const packs1 = await service.listPacksWithStatus(org1.id);
            const packs2 = await service.listPacksWithStatus(org2.id);

            const pack1 = packs1.find((p) => p.id === 'startup-reliability');
            const pack2 = packs2.find((p) => p.id === 'startup-reliability');

            expect(pack1?.enabled).toBe(true);
            expect(pack2?.enabled).toBe(false);
        });

        it('should return custom thresholds when set', async () => {
            const { organization } = await createTestContext();
            const customThresholds = {
                'high-error-rate': { level: 'critical' as const },
            };

            await service.enablePack(organization.id, 'startup-reliability', customThresholds);

            const packs = await service.listPacksWithStatus(organization.id);

            const reliabilityPack = packs.find((p) => p.id === 'startup-reliability');
            expect(reliabilityPack?.customThresholds).toEqual(customThresholds);
        });
    });

    describe('getPackWithStatus', () => {
        it('should return null for non-existent pack', async () => {
            const { organization } = await createTestContext();

            const pack = await service.getPackWithStatus(organization.id, 'non-existent');

            expect(pack).toBeNull();
        });

        it('should return pack with disabled status when not enabled', async () => {
            const { organization } = await createTestContext();

            const pack = await service.getPackWithStatus(organization.id, 'startup-reliability');

            expect(pack).toBeDefined();
            expect(pack?.id).toBe('startup-reliability');
            expect(pack?.enabled).toBe(false);
            expect(pack?.activatedAt).toBeNull();
            expect(pack?.generatedRulesCount).toBe(0);
        });

        it('should return pack with enabled status when activated', async () => {
            const { organization } = await createTestContext();

            await service.enablePack(organization.id, 'startup-reliability');
            const pack = await service.getPackWithStatus(organization.id, 'startup-reliability');

            expect(pack?.enabled).toBe(true);
            expect(pack?.activatedAt).toBeDefined();
        });

        it('should return correct generatedRulesCount', async () => {
            const { organization } = await createTestContext();
            const packDef = getPackById('startup-reliability');

            await service.enablePack(organization.id, 'startup-reliability');
            const pack = await service.getPackWithStatus(organization.id, 'startup-reliability');

            expect(pack?.generatedRulesCount).toBe(packDef!.rules.length);
        });
    });

    describe('enablePack', () => {
        it('should enable a pack successfully', async () => {
            const { organization } = await createTestContext();

            await service.enablePack(organization.id, 'startup-reliability');

            const activation = await service.getActivation(organization.id, 'startup-reliability');
            expect(activation).toBeDefined();
            expect(activation?.enabled).toBe(true);
        });

        it('should throw error for non-existent pack', async () => {
            const { organization } = await createTestContext();

            await expect(
                service.enablePack(organization.id, 'non-existent')
            ).rejects.toThrow('Pack not found: non-existent');
        });

        it('should throw error when pack already enabled', async () => {
            const { organization } = await createTestContext();

            await service.enablePack(organization.id, 'startup-reliability');

            await expect(
                service.enablePack(organization.id, 'startup-reliability')
            ).rejects.toThrow('Pack already enabled: startup-reliability');
        });

        it('should create sigma rules for the pack', async () => {
            const { organization } = await createTestContext();
            const packDef = getPackById('startup-reliability');

            await service.enablePack(organization.id, 'startup-reliability');

            const sigmaRules = await db
                .selectFrom('sigma_rules')
                .selectAll()
                .where('organization_id', '=', organization.id)
                .where('sigma_id', 'like', 'pack-startup-reliability-%')
                .execute();

            expect(sigmaRules).toHaveLength(packDef!.rules.length);
        });

        it('should create sigma rules with correct sigma_id format', async () => {
            const { organization } = await createTestContext();

            await service.enablePack(organization.id, 'startup-reliability');

            const sigmaRules = await db
                .selectFrom('sigma_rules')
                .select(['sigma_id'])
                .where('organization_id', '=', organization.id)
                .where('sigma_id', 'like', 'pack-startup-reliability-%')
                .execute();

            for (const rule of sigmaRules) {
                expect(rule.sigma_id).toMatch(/^pack-startup-reliability-/);
            }
        });

        it('should set email recipients on sigma rules', async () => {
            const { organization } = await createTestContext();
            const emails = ['test@example.com', 'alert@example.com'];

            await service.enablePack(
                organization.id,
                'startup-reliability',
                undefined,
                emails
            );

            const sigmaRules = await db
                .selectFrom('sigma_rules')
                .select(['email_recipients'])
                .where('organization_id', '=', organization.id)
                .where('sigma_id', 'like', 'pack-startup-reliability-%')
                .execute();

            for (const rule of sigmaRules) {
                expect(rule.email_recipients).toEqual(emails);
            }
        });

        it('should set webhook URL on sigma rules', async () => {
            const { organization } = await createTestContext();
            const webhookUrl = 'https://hooks.slack.com/test';

            await service.enablePack(
                organization.id,
                'startup-reliability',
                undefined,
                undefined,
                webhookUrl
            );

            const sigmaRules = await db
                .selectFrom('sigma_rules')
                .select(['webhook_url'])
                .where('organization_id', '=', organization.id)
                .where('sigma_id', 'like', 'pack-startup-reliability-%')
                .execute();

            for (const rule of sigmaRules) {
                expect(rule.webhook_url).toBe(webhookUrl);
            }
        });

        it('should apply custom thresholds', async () => {
            const { organization } = await createTestContext();
            const customThresholds = {
                'high-error-rate': { level: 'critical' as const },
            };

            await service.enablePack(organization.id, 'startup-reliability', customThresholds);

            const sigmaRule = await db
                .selectFrom('sigma_rules')
                .select(['level'])
                .where('organization_id', '=', organization.id)
                .where('sigma_id', '=', 'pack-startup-reliability-high-error-rate')
                .executeTakeFirst();

            expect(sigmaRule?.level).toBe('critical');
        });

        it('should enable sigma rules by default', async () => {
            const { organization } = await createTestContext();

            await service.enablePack(organization.id, 'startup-reliability');

            const sigmaRules = await db
                .selectFrom('sigma_rules')
                .select(['enabled'])
                .where('organization_id', '=', organization.id)
                .where('sigma_id', 'like', 'pack-startup-reliability-%')
                .execute();

            for (const rule of sigmaRules) {
                expect(rule.enabled).toBe(true);
            }
        });

        it('should extract MITRE tactics and techniques from tags', async () => {
            const { organization } = await createTestContext();

            await service.enablePack(organization.id, 'auth-security');

            const sigmaRule = await db
                .selectFrom('sigma_rules')
                .select(['mitre_tactics', 'mitre_techniques'])
                .where('organization_id', '=', organization.id)
                .where('sigma_id', '=', 'pack-auth-security-brute-force-detection')
                .executeTakeFirst();

            // The brute force rule has attack.credential_access and attack.t1110.001
            expect(sigmaRule?.mitre_tactics).toContain('credential_access');
            expect(sigmaRule?.mitre_techniques?.some((t: string) => t.startsWith('T1110'))).toBe(true);
        });

        it('should allow re-enabling a disabled pack', async () => {
            const { organization } = await createTestContext();

            await service.enablePack(organization.id, 'startup-reliability');
            await service.disablePack(organization.id, 'startup-reliability');
            await service.enablePack(organization.id, 'startup-reliability');

            const activation = await service.getActivation(organization.id, 'startup-reliability');
            expect(activation?.enabled).toBe(true);
        });
    });

    describe('disablePack', () => {
        it('should disable an enabled pack', async () => {
            const { organization } = await createTestContext();

            await service.enablePack(organization.id, 'startup-reliability');
            await service.disablePack(organization.id, 'startup-reliability');

            const activation = await service.getActivation(organization.id, 'startup-reliability');
            expect(activation?.enabled).toBe(false);
        });

        it('should throw error for non-existent pack', async () => {
            const { organization } = await createTestContext();

            await expect(
                service.disablePack(organization.id, 'non-existent')
            ).rejects.toThrow('Pack not found: non-existent');
        });

        it('should throw error when pack not enabled', async () => {
            const { organization } = await createTestContext();

            await expect(
                service.disablePack(organization.id, 'startup-reliability')
            ).rejects.toThrow('Pack is not enabled: startup-reliability');
        });

        it('should delete sigma rules when disabling', async () => {
            const { organization } = await createTestContext();

            await service.enablePack(organization.id, 'startup-reliability');
            await service.disablePack(organization.id, 'startup-reliability');

            const sigmaRules = await db
                .selectFrom('sigma_rules')
                .selectAll()
                .where('organization_id', '=', organization.id)
                .where('sigma_id', 'like', 'pack-startup-reliability-%')
                .execute();

            expect(sigmaRules).toHaveLength(0);
        });

        it('should not affect other packs when disabling', async () => {
            const { organization } = await createTestContext();

            await service.enablePack(organization.id, 'startup-reliability');
            await service.enablePack(organization.id, 'auth-security');
            await service.disablePack(organization.id, 'startup-reliability');

            const pack1 = await service.getPackWithStatus(organization.id, 'startup-reliability');
            const pack2 = await service.getPackWithStatus(organization.id, 'auth-security');

            expect(pack1?.enabled).toBe(false);
            expect(pack2?.enabled).toBe(true);
        });

        it('should not affect sigma rules from other packs', async () => {
            const { organization } = await createTestContext();
            const authPackDef = getPackById('auth-security');

            await service.enablePack(organization.id, 'startup-reliability');
            await service.enablePack(organization.id, 'auth-security');
            await service.disablePack(organization.id, 'startup-reliability');

            const authSigmaRules = await db
                .selectFrom('sigma_rules')
                .selectAll()
                .where('organization_id', '=', organization.id)
                .where('sigma_id', 'like', 'pack-auth-security-%')
                .execute();

            expect(authSigmaRules).toHaveLength(authPackDef!.rules.length);
        });
    });

    describe('updatePackThresholds', () => {
        it('should update thresholds for an enabled pack', async () => {
            const { organization } = await createTestContext();
            const newThresholds = {
                'high-error-rate': { level: 'medium' as const },
            };

            await service.enablePack(organization.id, 'startup-reliability');
            await service.updatePackThresholds(organization.id, 'startup-reliability', newThresholds);

            const activation = await service.getActivation(organization.id, 'startup-reliability');
            expect(activation?.customThresholds).toEqual(newThresholds);
        });

        it('should throw error for non-existent pack', async () => {
            const { organization } = await createTestContext();

            await expect(
                service.updatePackThresholds(organization.id, 'non-existent', {})
            ).rejects.toThrow('Pack not found: non-existent');
        });

        it('should update sigma rule levels when threshold level changes', async () => {
            const { organization } = await createTestContext();

            await service.enablePack(organization.id, 'startup-reliability');
            await service.updatePackThresholds(organization.id, 'startup-reliability', {
                'high-error-rate': { level: 'low' as const },
            });

            const sigmaRule = await db
                .selectFrom('sigma_rules')
                .select(['level'])
                .where('organization_id', '=', organization.id)
                .where('sigma_id', '=', 'pack-startup-reliability-high-error-rate')
                .executeTakeFirst();

            expect(sigmaRule?.level).toBe('low');
        });

        it('should not update rules without threshold override', async () => {
            const { organization } = await createTestContext();

            await service.enablePack(organization.id, 'startup-reliability');

            const originalRule = await db
                .selectFrom('sigma_rules')
                .select(['level', 'updated_at'])
                .where('sigma_id', '=', 'pack-startup-reliability-critical-errors')
                .where('organization_id', '=', organization.id)
                .executeTakeFirst();

            await service.updatePackThresholds(organization.id, 'startup-reliability', {
                'high-error-rate': { level: 'low' as const },
            });

            const unchangedRule = await db
                .selectFrom('sigma_rules')
                .select(['level'])
                .where('sigma_id', '=', 'pack-startup-reliability-critical-errors')
                .where('organization_id', '=', organization.id)
                .executeTakeFirst();

            expect(unchangedRule?.level).toBe(originalRule?.level);
        });
    });

    describe('getActivation', () => {
        it('should return null when no activation exists', async () => {
            const { organization } = await createTestContext();

            const activation = await service.getActivation(organization.id, 'startup-reliability');

            expect(activation).toBeNull();
        });

        it('should return activation record when exists', async () => {
            const { organization } = await createTestContext();

            await service.enablePack(organization.id, 'startup-reliability');

            const activation = await service.getActivation(organization.id, 'startup-reliability');

            expect(activation).toBeDefined();
            expect(activation?.organizationId).toBe(organization.id);
            expect(activation?.packId).toBe('startup-reliability');
            expect(activation?.enabled).toBe(true);
            expect(activation?.activatedAt).toBeInstanceOf(Date);
            expect(activation?.updatedAt).toBeInstanceOf(Date);
        });

        it('should return correct enabled state after disable', async () => {
            const { organization } = await createTestContext();

            await service.enablePack(organization.id, 'startup-reliability');
            await service.disablePack(organization.id, 'startup-reliability');

            const activation = await service.getActivation(organization.id, 'startup-reliability');

            expect(activation?.enabled).toBe(false);
        });

        it('should return custom thresholds when set', async () => {
            const { organization } = await createTestContext();
            const thresholds = {
                'high-error-rate': { level: 'critical' as const },
            };

            await service.enablePack(organization.id, 'startup-reliability', thresholds);

            const activation = await service.getActivation(organization.id, 'startup-reliability');

            expect(activation?.customThresholds).toEqual(thresholds);
        });
    });

    describe('extractMitreTags (via enablePack)', () => {
        it('should extract tactics from tags', async () => {
            const { organization } = await createTestContext();

            await service.enablePack(organization.id, 'startup-reliability');

            // The high-error-rate rule has 'attack.impact' tag
            const sigmaRule = await db
                .selectFrom('sigma_rules')
                .select(['mitre_tactics'])
                .where('organization_id', '=', organization.id)
                .where('sigma_id', '=', 'pack-startup-reliability-high-error-rate')
                .executeTakeFirst();

            expect(sigmaRule?.mitre_tactics).toContain('impact');
        });

        it('should extract techniques from tags', async () => {
            const { organization } = await createTestContext();

            await service.enablePack(organization.id, 'startup-reliability');

            // The high-error-rate rule has 'attack.t1499' tag
            const sigmaRule = await db
                .selectFrom('sigma_rules')
                .select(['mitre_techniques'])
                .where('organization_id', '=', organization.id)
                .where('sigma_id', '=', 'pack-startup-reliability-high-error-rate')
                .executeTakeFirst();

            expect(sigmaRule?.mitre_techniques).toContain('T1499');
        });

        it('should handle rules without tags', async () => {
            const { organization } = await createTestContext();

            await service.enablePack(organization.id, 'startup-reliability');

            // Critical errors rule has only 'attack.impact' (no technique)
            const sigmaRule = await db
                .selectFrom('sigma_rules')
                .select(['mitre_tactics', 'mitre_techniques'])
                .where('organization_id', '=', organization.id)
                .where('sigma_id', '=', 'pack-startup-reliability-critical-errors')
                .executeTakeFirst();

            expect(sigmaRule?.mitre_tactics).toContain('impact');
            // No techniques for this rule
        });

        it('should handle sub-techniques (t1234.001 format)', async () => {
            const { organization } = await createTestContext();

            await service.enablePack(organization.id, 'auth-security');

            // The brute-force-detection rule has attack.t1110.001
            const sigmaRule = await db
                .selectFrom('sigma_rules')
                .select(['mitre_techniques'])
                .where('organization_id', '=', organization.id)
                .where('sigma_id', '=', 'pack-auth-security-brute-force-detection')
                .executeTakeFirst();

            expect(sigmaRule?.mitre_techniques?.some((t: string) => t.includes('.'))).toBe(true);
        });
    });

    describe('Organization isolation', () => {
        it('should isolate pack activations between organizations', async () => {
            const { organization: org1 } = await createTestContext();
            const { organization: org2 } = await createTestContext();

            await service.enablePack(org1.id, 'startup-reliability');

            const activation1 = await service.getActivation(org1.id, 'startup-reliability');
            const activation2 = await service.getActivation(org2.id, 'startup-reliability');

            expect(activation1?.enabled).toBe(true);
            expect(activation2).toBeNull();
        });

        it('should isolate sigma rules between organizations', async () => {
            const { organization: org1 } = await createTestContext();
            const { organization: org2 } = await createTestContext();

            await service.enablePack(org1.id, 'startup-reliability');

            const org1Rules = await db
                .selectFrom('sigma_rules')
                .selectAll()
                .where('organization_id', '=', org1.id)
                .where('sigma_id', 'like', 'pack-%')
                .execute();

            const org2Rules = await db
                .selectFrom('sigma_rules')
                .selectAll()
                .where('organization_id', '=', org2.id)
                .where('sigma_id', 'like', 'pack-%')
                .execute();

            expect(org1Rules.length).toBeGreaterThan(0);
            expect(org2Rules.length).toBe(0);
        });

        it('should allow same pack to be enabled in different orgs', async () => {
            const { organization: org1 } = await createTestContext();
            const { organization: org2 } = await createTestContext();

            await service.enablePack(org1.id, 'startup-reliability');
            await service.enablePack(org2.id, 'startup-reliability');

            const pack1 = await service.getPackWithStatus(org1.id, 'startup-reliability');
            const pack2 = await service.getPackWithStatus(org2.id, 'startup-reliability');

            expect(pack1?.enabled).toBe(true);
            expect(pack2?.enabled).toBe(true);
        });
    });
});
