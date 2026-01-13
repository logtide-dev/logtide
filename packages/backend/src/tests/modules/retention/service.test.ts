import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetentionService } from '../../../modules/retention/service.js';
import { db } from '../../../database/index.js';
import {
  createTestContext,
  createTestLog,
  createTestProject,
  createTestOrganization,
} from '../../helpers/factories.js';

describe('RetentionService', () => {
  const service = new RetentionService();

  describe('validateRetentionDays', () => {
    it('should return valid for integer within range', () => {
      expect(service.validateRetentionDays(30)).toEqual({ valid: true });
      expect(service.validateRetentionDays(1)).toEqual({ valid: true });
      expect(service.validateRetentionDays(365)).toEqual({ valid: true });
    });

    it('should reject non-integer values', () => {
      const result = service.validateRetentionDays(30.5);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Retention days must be an integer');
    });

    it('should reject values less than 1', () => {
      const result = service.validateRetentionDays(0);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Retention days must be at least 1');
    });

    it('should reject values greater than 365', () => {
      const result = service.validateRetentionDays(366);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Retention days cannot exceed 365');
    });

    it('should reject negative values', () => {
      const result = service.validateRetentionDays(-1);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Retention days must be at least 1');
    });
  });

  describe('updateOrganizationRetention', () => {
    it('should update retention days for organization', async () => {
      const ctx = await createTestContext();

      const result = await service.updateOrganizationRetention(ctx.organization.id, 60);

      expect(result.success).toBe(true);
      expect(result.retentionDays).toBe(60);

      // Verify in database
      const org = await db
        .selectFrom('organizations')
        .select('retention_days')
        .where('id', '=', ctx.organization.id)
        .executeTakeFirst();

      expect(org?.retention_days).toBe(60);
    });

    it('should throw error for invalid retention days', async () => {
      const ctx = await createTestContext();

      await expect(
        service.updateOrganizationRetention(ctx.organization.id, 500)
      ).rejects.toThrow('Retention days cannot exceed 365');
    });

    it('should throw error for non-existent organization', async () => {
      await expect(
        service.updateOrganizationRetention('00000000-0000-0000-0000-000000000000', 30)
      ).rejects.toThrow('Organization not found');
    });

    it('should accept edge case of 1 day', async () => {
      const ctx = await createTestContext();

      const result = await service.updateOrganizationRetention(ctx.organization.id, 1);

      expect(result.success).toBe(true);
      expect(result.retentionDays).toBe(1);
    });

    it('should accept edge case of 365 days', async () => {
      const ctx = await createTestContext();

      const result = await service.updateOrganizationRetention(ctx.organization.id, 365);

      expect(result.success).toBe(true);
      expect(result.retentionDays).toBe(365);
    });
  });

  describe('getOrganizationRetentionStatus', () => {
    it('should return retention status for organization with logs', async () => {
      const ctx = await createTestContext();

      // Create some test logs
      await createTestLog({ projectId: ctx.project.id });
      await createTestLog({ projectId: ctx.project.id });

      const status = await service.getOrganizationRetentionStatus(ctx.organization.id);

      expect(status.organizationId).toBe(ctx.organization.id);
      expect(status.organizationName).toBe(ctx.organization.name);
      expect(status.retentionDays).toBeDefined();
      expect(status.totalLogs).toBeGreaterThanOrEqual(2);
    });

    it('should return zero counts for organization without projects', async () => {
      // Create org without any projects
      const org = await db
        .insertInto('organizations')
        .values({
          name: 'Empty Org',
          slug: `empty-org-${Date.now()}`,
          owner_id: (await createTestContext()).user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const status = await service.getOrganizationRetentionStatus(org.id);

      expect(status.organizationId).toBe(org.id);
      expect(status.totalLogs).toBe(0);
      expect(status.logsToDelete).toBe(0);
      expect(status.oldestLogTime).toBeNull();
    });

    it('should throw error for non-existent organization', async () => {
      await expect(
        service.getOrganizationRetentionStatus('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('Organization not found');
    });

    it('should calculate logs to delete based on retention days', async () => {
      const ctx = await createTestContext();

      // Update retention to 1 day for easier testing
      await db
        .updateTable('organizations')
        .set({ retention_days: 1 })
        .where('id', '=', ctx.organization.id)
        .execute();

      // Create an old log (2 days ago)
      const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await createTestLog({ projectId: ctx.project.id, time: oldDate });

      // Create a recent log
      await createTestLog({ projectId: ctx.project.id });

      const status = await service.getOrganizationRetentionStatus(ctx.organization.id);

      expect(status.logsToDelete).toBeGreaterThanOrEqual(1);
    });
  });

  describe('executeRetentionForOrganization', () => {
    it('should delete old logs based on retention policy', async () => {
      const ctx = await createTestContext();

      // Set retention to 1 day
      await db
        .updateTable('organizations')
        .set({ retention_days: 1 })
        .where('id', '=', ctx.organization.id)
        .execute();

      // Create an old log (3 days ago)
      const oldDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      await createTestLog({ projectId: ctx.project.id, time: oldDate, message: 'old log' });

      // Create a recent log
      await createTestLog({ projectId: ctx.project.id, message: 'new log' });

      const result = await service.executeRetentionForOrganization(
        ctx.organization.id,
        1,
        ctx.organization.name
      );

      expect(result.organizationId).toBe(ctx.organization.id);
      expect(result.retentionDays).toBe(1);
      expect(result.logsDeleted).toBeGreaterThanOrEqual(1);
      expect(result.error).toBeUndefined();
    });

    it('should return zero deleted when no old logs exist', async () => {
      const ctx = await createTestContext();

      // Create only recent logs
      await createTestLog({ projectId: ctx.project.id });

      const result = await service.executeRetentionForOrganization(
        ctx.organization.id,
        30,
        ctx.organization.name
      );

      expect(result.logsDeleted).toBe(0);
    });

    it('should return zero deleted for organization without projects', async () => {
      const org = await db
        .insertInto('organizations')
        .values({
          name: 'No Projects Org',
          slug: `no-projects-org-${Date.now()}`,
          owner_id: (await createTestContext()).user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const result = await service.executeRetentionForOrganization(org.id, 30, org.name);

      expect(result.logsDeleted).toBe(0);
    });

    it('should include execution time in result', async () => {
      const ctx = await createTestContext();

      const result = await service.executeRetentionForOrganization(
        ctx.organization.id,
        30,
        ctx.organization.name
      );

      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('executeRetentionForAllOrganizations', () => {
    it('should execute retention for all organizations', async () => {
      const ctx1 = await createTestContext();
      const ctx2 = await createTestContext();

      // Create logs for both
      await createTestLog({ projectId: ctx1.project.id });
      await createTestLog({ projectId: ctx2.project.id });

      const summary = await service.executeRetentionForAllOrganizations();

      expect(summary.totalOrganizations).toBeGreaterThanOrEqual(2);
      expect(summary.successfulOrganizations).toBeGreaterThanOrEqual(2);
      expect(summary.failedOrganizations).toBeGreaterThanOrEqual(0);
      expect(summary.results).toBeDefined();
      expect(summary.totalExecutionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should return results for each organization', async () => {
      await createTestContext();

      const summary = await service.executeRetentionForAllOrganizations();

      expect(summary.results.length).toBe(summary.totalOrganizations);
      summary.results.forEach((result) => {
        expect(result.organizationId).toBeDefined();
        expect(result.organizationName).toBeDefined();
        expect(result.retentionDays).toBeDefined();
        expect(typeof result.logsDeleted).toBe('number');
      });
    });

    it('should aggregate total logs deleted', async () => {
      const ctx = await createTestContext();

      // Set retention to 1 day
      await db
        .updateTable('organizations')
        .set({ retention_days: 1 })
        .where('id', '=', ctx.organization.id)
        .execute();

      // Create old logs
      const oldDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      await createTestLog({ projectId: ctx.project.id, time: oldDate });
      await createTestLog({ projectId: ctx.project.id, time: oldDate });

      const summary = await service.executeRetentionForAllOrganizations();

      // Total should be sum of all results
      const sumFromResults = summary.results.reduce((sum, r) => sum + r.logsDeleted, 0);
      expect(summary.totalLogsDeleted).toBe(sumFromResults);
    });
  });
});
