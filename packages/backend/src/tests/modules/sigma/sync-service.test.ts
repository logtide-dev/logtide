import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { SigmaSyncService } from '../../../modules/sigma/sync-service.js';
import { createTestContext } from '../../helpers/factories.js';

// Mock github client - never hit the network
vi.mock('../../../modules/sigma/github-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/sigma/github-client.js')>();
  return {
    ...actual,
    sigmahqClient: {
      getLatestCommit: vi.fn().mockResolvedValue('commit-abc'),
      fetchRulesByCategory: vi.fn().mockResolvedValue([]),
      fetchAllRules: vi.fn().mockResolvedValue([]),
      fetchRule: vi.fn().mockResolvedValue(''),
      getCategories: vi.fn().mockResolvedValue([
        { name: 'linux', path: 'rules/linux', ruleCount: 10 },
        { name: 'windows', path: 'rules/windows', ruleCount: 5 },
      ]),
      buildCategoryTree: vi.fn().mockResolvedValue([]),
      getRulesForCategory: vi.fn().mockResolvedValue([]),
      searchRules: vi.fn().mockResolvedValue([]),
    },
  };
});

const VALID_YAML = `
title: Test Rule
id: b0000000-0000-0000-0000-000000000001
status: stable
level: medium
tags:
    - attack.execution
    - attack.t1059
mitre_tactics: ['execution']
logsource:
    product: linux
detection:
    selection:
        message|contains: 'suspicious'
    condition: selection
`;

describe('SigmaSyncService - extra methods', () => {
  let service: SigmaSyncService;
  let orgId: string;
  let otherOrgId: string;

  beforeEach(async () => {
    service = new SigmaSyncService();
    await db.deleteFrom('sigma_rules').execute();
    await db.deleteFrom('alert_rules').execute();
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    const otherCtx = await createTestContext();
    otherOrgId = otherCtx.organization.id;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // getCategories
  // -------------------------------------------------------------------------
  describe('getCategories', () => {
    it('returns categories from the github client', async () => {
      const cats = await service.getCategories();
      expect(cats).toHaveLength(2);
      expect(cats[0].name).toBe('linux');
    });
  });

  // -------------------------------------------------------------------------
  // getSyncStatus
  // -------------------------------------------------------------------------
  describe('getSyncStatus', () => {
    it('returns zeros and null lastSyncedAt when no rules exist', async () => {
      const status = await service.getSyncStatus(orgId);
      expect(status.organizationId).toBe(orgId);
      expect(status.totalRules).toBe(0);
      expect(status.syncedRules).toBe(0);
      expect(status.failedRules).toBe(0);
      expect(status.lastSyncedAt).toBeNull();
      expect(status.nextScheduledSync).toBeInstanceOf(Date);
    });

    it('reflects correct counts after inserting rules', async () => {
      const now = new Date();
      // 2 successful rules
      await db.insertInto('sigma_rules').values({
        organization_id: orgId,
        title: 'Rule 1',
        logsource: {},
        detection: {},
        conversion_status: 'success',
        last_synced_at: now,
      }).execute();
      await db.insertInto('sigma_rules').values({
        organization_id: orgId,
        title: 'Rule 2',
        logsource: {},
        detection: {},
        conversion_status: 'success',
        last_synced_at: now,
      }).execute();
      // 1 failed rule
      await db.insertInto('sigma_rules').values({
        organization_id: orgId,
        title: 'Bad Rule',
        logsource: {},
        detection: {},
        conversion_status: 'failed',
        last_synced_at: now,
      }).execute();

      const status = await service.getSyncStatus(orgId);
      expect(status.totalRules).toBe(3);
      expect(status.failedRules).toBe(1);
      expect(status.syncedRules).toBe(2);
      expect(status.lastSyncedAt).toBeInstanceOf(Date);
    });

    it('nextScheduledSync is in the future', async () => {
      const status = await service.getSyncStatus(orgId);
      expect(status.nextScheduledSync!.getTime()).toBeGreaterThan(Date.now());
    });

    it('nextScheduledSync is set to 2:00 AM', async () => {
      const status = await service.getSyncStatus(orgId);
      const next = status.nextScheduledSync!;
      expect(next.getHours()).toBe(2);
      expect(next.getMinutes()).toBe(0);
      expect(next.getSeconds()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // MITRE / tag search (regression: these used a text[] @> ::jsonb cast that
  // postgres rejected, so the search endpoints 500ed until WS5 fixed the SQL)
  // -------------------------------------------------------------------------

  describe('searchByMITRETechnique', () => {
    it('returns rules tagged with the technique, org scoped', async () => {
      await db.insertInto('sigma_rules').values({
        organization_id: orgId,
        title: 'Technique Rule',
        logsource: {},
        detection: {},
        conversion_status: 'success',
        mitre_techniques: ['T1059', 'T1027'],
      }).execute();
      await db.insertInto('sigma_rules').values({
        organization_id: orgId,
        title: 'Other Rule',
        logsource: {},
        detection: {},
        conversion_status: 'success',
        mitre_techniques: ['T1110'],
      }).execute();

      const rules = await service.searchByMITRETechnique(orgId, 'T1059');
      expect(rules).toHaveLength(1);
      expect(rules[0].title).toBe('Technique Rule');

      const none = await service.searchByMITRETechnique(otherOrgId, 'T1059');
      expect(none).toHaveLength(0);
    });
  });

  describe('searchByMITRETactic', () => {
    it('returns rules tagged with the tactic', async () => {
      await db.insertInto('sigma_rules').values({
        organization_id: orgId,
        title: 'Tactic Rule',
        logsource: {},
        detection: {},
        conversion_status: 'success',
        mitre_tactics: ['execution'],
      }).execute();

      const rules = await service.searchByMITRETactic(orgId, 'execution');
      expect(rules).toHaveLength(1);
      expect(rules[0].title).toBe('Tactic Rule');
    });
  });

  describe('searchByTag', () => {
    it('returns rules carrying the tag', async () => {
      await db.insertInto('sigma_rules').values({
        organization_id: orgId,
        title: 'Tagged Rule',
        logsource: {},
        detection: {},
        conversion_status: 'success',
        tags: ['attack.execution', 'attack.t1059'],
      }).execute();

      const rules = await service.searchByTag(orgId, 'attack.execution');
      expect(rules).toHaveLength(1);
      expect(rules[0].title).toBe('Tagged Rule');

      const none = await service.searchByTag(orgId, 'attack.persistence');
      expect(none).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // syncFromSigmaHQ - additional branches
  // -------------------------------------------------------------------------
  describe('syncFromSigmaHQ additional paths', () => {
    it('fetches all rules when no category or selection provided', async () => {
      const { sigmahqClient } = await import('../../../modules/sigma/github-client.js');
      (sigmahqClient.fetchAllRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await service.syncFromSigmaHQ({ organizationId: orgId });
      expect(result.success).toBe(true);
      expect(result.imported).toBe(0);
    });

    it('handles fetch error during sync gracefully', async () => {
      const { sigmahqClient } = await import('../../../modules/sigma/github-client.js');
      (sigmahqClient.getLatestCommit as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('network error')
      );

      const result = await service.syncFromSigmaHQ({ organizationId: orgId });
      expect(result.success).toBe(false);
      expect(result.errors[0].error).toBe('network error');
    });

    it('skips rules already synced with same commit hash', async () => {
      // Insert a rule with commit 'commit-abc' (same as mock)
      await db.insertInto('sigma_rules').values({
        organization_id: orgId,
        title: 'Existing Rule',
        logsource: {},
        detection: {},
        sigmahq_path: 'rules/linux/existing.yml',
        sigmahq_commit: 'commit-abc',
      }).execute();

      const { sigmahqClient } = await import('../../../modules/sigma/github-client.js');
      (sigmahqClient.fetchRulesByCategory as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { path: 'rules/linux/existing.yml', name: 'existing.yml', category: 'linux', downloadUrl: 'http://x', sha: 'sha1' },
      ]);

      const result = await service.syncFromSigmaHQ({
        organizationId: orgId,
        selection: { categories: ['linux'] },
      });

      expect(result.skipped).toBe(1);
      expect(result.imported).toBe(0);
    });

    it('handles granular selection with individual rules', async () => {
      const { sigmahqClient } = await import('../../../modules/sigma/github-client.js');
      (sigmahqClient.fetchRule as ReturnType<typeof vi.fn>).mockResolvedValueOnce(VALID_YAML);

      const result = await service.syncFromSigmaHQ({
        organizationId: orgId,
        selection: { rules: ['rules/linux/test.yml'] },
        autoCreateAlerts: false,
      });

      // Rule fetched and imported
      expect(result.imported).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('deduplicates rules when categories and individual rules overlap', async () => {
      const { sigmahqClient } = await import('../../../modules/sigma/github-client.js');
      (sigmahqClient.fetchRulesByCategory as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { path: 'rules/linux/rule.yml', name: 'rule.yml', category: 'linux', downloadUrl: 'http://x', sha: 'sha1' },
      ]);
      (sigmahqClient.fetchRule as ReturnType<typeof vi.fn>).mockResolvedValue(VALID_YAML);

      const result = await service.syncFromSigmaHQ({
        organizationId: orgId,
        selection: {
          categories: ['linux'],
          rules: ['rules/linux/rule.yml'], // duplicate
        },
        autoCreateAlerts: false,
      });

      // Only imported once
      expect(result.imported).toBe(1);
    });

    it('handles parse failure for a rule gracefully', async () => {
      const { sigmahqClient } = await import('../../../modules/sigma/github-client.js');
      (sigmahqClient.fetchRulesByCategory as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { path: 'rules/linux/bad.yml', name: 'bad.yml', category: 'linux', downloadUrl: 'http://x', sha: 'sha1' },
      ]);
      (sigmahqClient.fetchRule as ReturnType<typeof vi.fn>).mockResolvedValueOnce('not valid yaml: {{{');

      const result = await service.syncFromSigmaHQ({
        organizationId: orgId,
        selection: { categories: ['linux'] },
        autoCreateAlerts: false,
      });

      expect(result.failed).toBe(1);
      expect(result.errors[0].rule).toBe('bad.yml');
    });

    it('handles non-Error thrown during rule processing', async () => {
      const { sigmahqClient } = await import('../../../modules/sigma/github-client.js');
      (sigmahqClient.fetchRulesByCategory as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { path: 'rules/linux/err.yml', name: 'err.yml', category: 'linux', downloadUrl: 'http://x', sha: 'sha1' },
      ]);
      // Throw a non-Error string (covers the `error instanceof Error ? ... : 'Unknown error'` false branch)
      (sigmahqClient.fetchRule as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw 'string error, not an Error instance';
      });

      const result = await service.syncFromSigmaHQ({
        organizationId: orgId,
        selection: { categories: ['linux'] },
        autoCreateAlerts: false,
      });

      expect(result.failed).toBe(1);
      expect(result.errors[0].error).toBe('Unknown error');
    });

    it('applies limit to rule list', async () => {
      const { sigmahqClient } = await import('../../../modules/sigma/github-client.js');
      (sigmahqClient.fetchRulesByCategory as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { path: 'rules/linux/r1.yml', name: 'r1.yml', category: 'linux', downloadUrl: 'http://x', sha: 'sha1' },
        { path: 'rules/linux/r2.yml', name: 'r2.yml', category: 'linux', downloadUrl: 'http://x', sha: 'sha2' },
        { path: 'rules/linux/r3.yml', name: 'r3.yml', category: 'linux', downloadUrl: 'http://x', sha: 'sha3' },
      ]);
      (sigmahqClient.fetchRule as ReturnType<typeof vi.fn>).mockResolvedValue(VALID_YAML);

      const result = await service.syncFromSigmaHQ({
        organizationId: orgId,
        selection: { categories: ['linux'] },
        limit: 1,
        autoCreateAlerts: false,
      });

      expect(result.imported + result.failed + result.skipped).toBeLessThanOrEqual(1);
    });

    it('calls onProgress callback for each rule', async () => {
      const { sigmahqClient } = await import('../../../modules/sigma/github-client.js');
      (sigmahqClient.fetchRulesByCategory as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { path: 'rules/linux/prog.yml', name: 'prog.yml', category: 'linux', downloadUrl: 'http://x', sha: 'sha1' },
      ]);
      (sigmahqClient.fetchRule as ReturnType<typeof vi.fn>).mockResolvedValue(VALID_YAML);

      const progressCalls: Array<[number, number, string]> = [];
      await service.syncFromSigmaHQ({
        organizationId: orgId,
        selection: { categories: ['linux'] },
        autoCreateAlerts: false,
        onProgress: (cur, tot, name) => progressCalls.push([cur, tot, name]),
      });

      expect(progressCalls).toHaveLength(1);
      expect(progressCalls[0][2]).toBe('prog.yml');
    });

    it('updates existing rule when commit differs', async () => {
      const { sigmahqClient } = await import('../../../modules/sigma/github-client.js');

      // Pre-existing rule with different commit
      await db.insertInto('sigma_rules').values({
        organization_id: orgId,
        title: 'Old Rule',
        logsource: {},
        detection: {},
        sigmahq_path: 'rules/linux/update.yml',
        sigmahq_commit: 'old-commit',
      }).execute();

      (sigmahqClient.fetchRulesByCategory as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { path: 'rules/linux/update.yml', name: 'update.yml', category: 'linux', downloadUrl: 'http://x', sha: 'sha1' },
      ]);
      (sigmahqClient.fetchRule as ReturnType<typeof vi.fn>).mockResolvedValue(VALID_YAML);

      const result = await service.syncFromSigmaHQ({
        organizationId: orgId,
        selection: { categories: ['linux'] },
        autoCreateAlerts: false,
      });

      expect(result.imported).toBe(1);

      const updated = await db
        .selectFrom('sigma_rules')
        .select('sigmahq_commit')
        .where('sigmahq_path', '=', 'rules/linux/update.yml')
        .executeTakeFirst();
      expect(updated?.sigmahq_commit).toBe('commit-abc');
    });

    it('creates alert rule when autoCreateAlerts=true and conversion succeeds', async () => {
      const { sigmahqClient } = await import('../../../modules/sigma/github-client.js');
      (sigmahqClient.fetchRulesByCategory as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { path: 'rules/linux/alert.yml', name: 'alert.yml', category: 'linux', downloadUrl: 'http://x', sha: 'sha1' },
      ]);
      (sigmahqClient.fetchRule as ReturnType<typeof vi.fn>).mockResolvedValue(VALID_YAML);

      const result = await service.syncFromSigmaHQ({
        organizationId: orgId,
        selection: { categories: ['linux'] },
        autoCreateAlerts: true,
      });

      expect(result.imported).toBe(1);
    });

    it('does NOT create an alert rule when autoCreateAlerts=false (sigma rules are independent)', async () => {
      const { sigmahqClient } = await import('../../../modules/sigma/github-client.js');
      (sigmahqClient.fetchRulesByCategory as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { path: 'rules/linux/noalert.yml', name: 'noalert.yml', category: 'linux', downloadUrl: 'http://x', sha: 'sha1' },
      ]);
      (sigmahqClient.fetchRule as ReturnType<typeof vi.fn>).mockResolvedValue(VALID_YAML);

      const result = await service.syncFromSigmaHQ({
        organizationId: orgId,
        selection: { categories: ['linux'] },
        autoCreateAlerts: false,
      });

      expect(result.imported).toBe(1);

      // No alert_rules row should be created for this org (the cron path that
      // passed autoCreateAlerts:true used to spawn an alert rule per sigma rule).
      const alerts = await db
        .selectFrom('alert_rules')
        .select('id')
        .where('organization_id', '=', orgId)
        .execute();
      expect(alerts).toHaveLength(0);

      // ...and the imported sigma rule must not be linked to one.
      const rule = await db
        .selectFrom('sigma_rules')
        .select('alert_rule_id')
        .where('sigmahq_path', '=', 'rules/linux/noalert.yml')
        .executeTakeFirst();
      expect(rule?.alert_rule_id).toBeNull();
    });
  });
});
