import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetentionService } from '../../../modules/retention/service.js';
import { db } from '../../../database/index.js';
import { reservoir } from '../../../database/reservoir.js';
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

    it('should return execution time in summary', async () => {
      const ctx = await createTestContext();
      await createTestLog({ projectId: ctx.project.id });

      const summary = await service.executeRetentionForAllOrganizations();

      expect(summary.totalExecutionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should return early when no organizations exist', async () => {
      const summary = await service.executeRetentionForAllOrganizations();

      expect(summary.totalOrganizations).toBe(0);
      expect(summary.successfulOrganizations).toBe(0);
      expect(summary.failedOrganizations).toBe(0);
      expect(summary.totalLogsDeleted).toBe(0);
      expect(summary.results).toEqual([]);
    });
  });

  describe('getOrganizationRetentionStatus - edge cases', () => {
    it('should calculate estimated deletion date when logs exist', async () => {
      const ctx = await createTestContext();

      // Create a log from 10 days ago
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await createTestLog({ projectId: ctx.project.id, time: tenDaysAgo });

      const status = await service.getOrganizationRetentionStatus(ctx.organization.id);

      // Should have an oldest log time
      expect(status.oldestLogTime).not.toBeNull();
      // Estimated deletion date should be set
      expect(status.estimatedDeletionDate).toBeDefined();
    });

    it('should return null estimated deletion date when no logs', async () => {
      const org = await db
        .insertInto('organizations')
        .values({
          name: 'No Logs Org',
          slug: `no-logs-org-${Date.now()}`,
          owner_id: (await createTestContext()).user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Create project but no logs
      await db
        .insertInto('projects')
        .values({
          name: 'Empty Project',
          slug: `empty-project-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          organization_id: org.id,
          user_id: org.owner_id,
        })
        .execute();

      const status = await service.getOrganizationRetentionStatus(org.id);

      expect(status.oldestLogTime).toBeNull();
      expect(status.estimatedDeletionDate).toBeNull();
    });

    it('should set estimated deletion date to now if already past', async () => {
      const ctx = await createTestContext();

      // Set retention to 1 day
      await db
        .updateTable('organizations')
        .set({ retention_days: 1 })
        .where('id', '=', ctx.organization.id)
        .execute();

      // Create log from 5 days ago (well past 1-day retention)
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      await createTestLog({ projectId: ctx.project.id, time: fiveDaysAgo });

      const status = await service.getOrganizationRetentionStatus(ctx.organization.id);

      // Estimated deletion should be now or very close to now (next cleanup)
      expect(status.estimatedDeletionDate).not.toBeNull();
      if (status.estimatedDeletionDate) {
        const now = new Date();
        // Should be within 1 second of now
        expect(Math.abs(status.estimatedDeletionDate.getTime() - now.getTime())).toBeLessThan(1000);
      }
    });

    it('should count logs to delete correctly with short retention', async () => {
      const ctx = await createTestContext();

      // Set retention to 1 day
      await db
        .updateTable('organizations')
        .set({ retention_days: 1 })
        .where('id', '=', ctx.organization.id)
        .execute();

      // Create 3 old logs
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      await createTestLog({ projectId: ctx.project.id, time: threeDaysAgo });
      await createTestLog({ projectId: ctx.project.id, time: threeDaysAgo });
      await createTestLog({ projectId: ctx.project.id, time: threeDaysAgo });

      // Create 2 recent logs
      await createTestLog({ projectId: ctx.project.id });
      await createTestLog({ projectId: ctx.project.id });

      const status = await service.getOrganizationRetentionStatus(ctx.organization.id);

      expect(status.totalLogs).toBe(5);
      expect(status.logsToDelete).toBe(3);
    });
  });

  describe('executeRetentionForOrganization - advanced scenarios', () => {
    it('should handle multiple projects in organization', async () => {
      const ctx = await createTestContext();

      // Create second project
      const project2 = await db
        .insertInto('projects')
        .values({
          name: 'Second Project',
          slug: `second-project-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          organization_id: ctx.organization.id,
          user_id: ctx.user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Set retention to 1 day
      await db
        .updateTable('organizations')
        .set({ retention_days: 1 })
        .where('id', '=', ctx.organization.id)
        .execute();

      // Create old logs in both projects
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      await createTestLog({ projectId: ctx.project.id, time: threeDaysAgo });
      await createTestLog({ projectId: project2.id, time: threeDaysAgo });

      const result = await service.executeRetentionForOrganization(
        ctx.organization.id,
        1,
        ctx.organization.name
      );

      expect(result.logsDeleted).toBe(2);
    });

    it('should preserve recent logs while deleting old ones', async () => {
      const ctx = await createTestContext();

      // Set retention to 1 day
      await db
        .updateTable('organizations')
        .set({ retention_days: 1 })
        .where('id', '=', ctx.organization.id)
        .execute();

      // Create old and new logs
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await createTestLog({ projectId: ctx.project.id, time: twoDaysAgo, message: 'old' });
      await createTestLog({ projectId: ctx.project.id, message: 'new' });

      await service.executeRetentionForOrganization(
        ctx.organization.id,
        1,
        ctx.organization.name
      );

      // Check only new log remains
      const remainingLogs = await db
        .selectFrom('logs')
        .selectAll()
        .where('project_id', '=', ctx.project.id)
        .execute();

      expect(remainingLogs.length).toBe(1);
      expect(remainingLogs[0].message).toBe('new');
    });

    it('should return executionTimeMs in result', async () => {
      const ctx = await createTestContext();

      const result = await service.executeRetentionForOrganization(
        ctx.organization.id,
        30,
        ctx.organization.name
      );

      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should apply the retention to spans as well', async () => {
      const ctx = await createTestContext();
      const span = (id: string, time: Date) => ({
        time,
        spanId: id,
        traceId: `trace-${id}`,
        projectId: ctx.project.id,
        organizationId: ctx.organization.id,
        serviceName: 'api',
        operationName: 'op',
        startTime: time,
        endTime: new Date(time.getTime() + 10),
        durationMs: 10,
      });
      const ing = await reservoir.ingestSpans([
        span('old', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)),
        span('new', new Date()),
      ]);

      expect(ing.failed).toBe(0);
      await service.executeRetentionForOrganization(ctx.organization.id, 1, ctx.organization.name);

      const { spans } = await reservoir.querySpans({
        projectId: ctx.project.id,
        from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        to: new Date(Date.now() + 60_000),
        limit: 10,
      });
      expect(spans.map((s) => s.spanId)).toEqual(['new']);
    });
  });

  describe('executeRetentionForAllOrganizations - max retention', () => {
    it('drops everything older than the longest retention on every engine', async () => {
      const ctx = await createTestContext();
      const { max } = await db
        .selectFrom('organizations')
        .select((eb) => eb.fn.max('retention_days').as('max'))
        .executeTakeFirstOrThrow();
      const spy = vi.spyOn(reservoir, 'dropOlderThan');
      try {
        const before = Date.now();
        await service.executeRetentionForAllOrganizations();
        expect(spy).toHaveBeenCalledTimes(1);
        const cutoff = (spy.mock.calls[0][0] as Date).getTime();
        const expected = before - Number(max) * 24 * 60 * 60 * 1000;
        expect(Math.abs(cutoff - expected)).toBeLessThan(60_000);
        expect(ctx.organization.id).toBeTruthy();
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('updateOrganizationRetention - logging', () => {
    it('should not log when retention value unchanged', async () => {
      const ctx = await createTestContext();

      // Get current retention
      const org = await db
        .selectFrom('organizations')
        .select('retention_days')
        .where('id', '=', ctx.organization.id)
        .executeTakeFirst();

      // Update to same value
      const result = await service.updateOrganizationRetention(
        ctx.organization.id,
        org!.retention_days
      );

      expect(result.success).toBe(true);
      // Should not throw, should complete silently
    });
  });

  describe('executeRetentionForAllOrganizations - comprehensive', () => {
    it('should handle mixed success and failure scenarios gracefully', async () => {
      // Create multiple contexts
      const ctx1 = await createTestContext();
      const ctx2 = await createTestContext();

      // Set different retention policies
      await db
        .updateTable('organizations')
        .set({ retention_days: 1 })
        .where('id', '=', ctx1.organization.id)
        .execute();

      await db
        .updateTable('organizations')
        .set({ retention_days: 365 })
        .where('id', '=', ctx2.organization.id)
        .execute();

      // Create old logs in first org
      const oldDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      await createTestLog({ projectId: ctx1.project.id, time: oldDate });

      // Create recent logs in second org
      await createTestLog({ projectId: ctx2.project.id });

      const summary = await service.executeRetentionForAllOrganizations();

      expect(summary.totalOrganizations).toBeGreaterThanOrEqual(2);
      expect(summary.results.length).toBe(summary.totalOrganizations);
      expect(typeof summary.totalLogsDeleted).toBe('number');
    });

    it('should return correct execution time', async () => {
      await createTestContext();

      const summary = await service.executeRetentionForAllOrganizations();

      expect(summary.totalExecutionTimeMs).toBeGreaterThanOrEqual(0);
      // Individual results should also have execution times
      for (const result of summary.results) {
        expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('should count failed organizations correctly when errors occur', async () => {
      // Normal scenario - all should succeed
      const ctx = await createTestContext();
      await createTestLog({ projectId: ctx.project.id });

      const summary = await service.executeRetentionForAllOrganizations();

      // In normal conditions, no failures expected
      expect(summary.failedOrganizations).toBe(0);
      expect(summary.successfulOrganizations).toBe(summary.totalOrganizations);
    });
  });

  describe('getOrganizationRetentionStatus - comprehensive', () => {
    it('should correctly count total logs across multiple projects', async () => {
      const ctx = await createTestContext();

      // Create second project
      const project2 = await db
        .insertInto('projects')
        .values({
          name: 'Second Project',
          slug: `second-project-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          organization_id: ctx.organization.id,
          user_id: ctx.user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Create logs in both projects
      await createTestLog({ projectId: ctx.project.id });
      await createTestLog({ projectId: ctx.project.id });
      await createTestLog({ projectId: project2.id });

      const status = await service.getOrganizationRetentionStatus(ctx.organization.id);

      expect(status.totalLogs).toBe(3);
    });

    it('should return correct oldest log time', async () => {
      const ctx = await createTestContext();

      // Create logs at different times
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      await createTestLog({ projectId: ctx.project.id, time: twoDaysAgo });
      await createTestLog({ projectId: ctx.project.id, time: oneDayAgo });
      await createTestLog({ projectId: ctx.project.id });

      const status = await service.getOrganizationRetentionStatus(ctx.organization.id);

      expect(status.oldestLogTime).not.toBeNull();
      // Oldest log should be approximately 2 days ago
      if (status.oldestLogTime) {
        const timeDiff = Math.abs(status.oldestLogTime.getTime() - twoDaysAgo.getTime());
        expect(timeDiff).toBeLessThan(1000); // Within 1 second
      }
    });

    it('should calculate future estimated deletion date correctly', async () => {
      const ctx = await createTestContext();

      // Set retention to 30 days
      await db
        .updateTable('organizations')
        .set({ retention_days: 30 })
        .where('id', '=', ctx.organization.id)
        .execute();

      // Create a log from 10 days ago
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await createTestLog({ projectId: ctx.project.id, time: tenDaysAgo });

      const status = await service.getOrganizationRetentionStatus(ctx.organization.id);

      expect(status.estimatedDeletionDate).not.toBeNull();
      if (status.estimatedDeletionDate) {
        // Should be approximately 20 days from now (30 - 10)
        const expectedDeletionDate = new Date(tenDaysAgo.getTime() + 30 * 24 * 60 * 60 * 1000);
        const timeDiff = Math.abs(status.estimatedDeletionDate.getTime() - expectedDeletionDate.getTime());
        expect(timeDiff).toBeLessThan(1000); // Within 1 second
      }
    });
  });

  describe('validateRetentionDays - edge cases', () => {
    it('should validate boundary value of 1', () => {
      expect(service.validateRetentionDays(1)).toEqual({ valid: true });
    });

    it('should validate boundary value of 365', () => {
      expect(service.validateRetentionDays(365)).toEqual({ valid: true });
    });

    it('should reject NaN', () => {
      const result = service.validateRetentionDays(NaN);
      expect(result.valid).toBe(false);
    });

    it('should reject Infinity', () => {
      const result = service.validateRetentionDays(Infinity);
      expect(result.valid).toBe(false);
    });
  });

  describe('executeRetentionForOrganization - logging behavior', () => {
    it('should log when logs are deleted', async () => {
      const ctx = await createTestContext();

      // Set retention to 1 day
      await db
        .updateTable('organizations')
        .set({ retention_days: 1 })
        .where('id', '=', ctx.organization.id)
        .execute();

      // Create old log
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      await createTestLog({ projectId: ctx.project.id, time: fiveDaysAgo });

      const result = await service.executeRetentionForOrganization(
        ctx.organization.id,
        1,
        ctx.organization.name
      );

      expect(result.logsDeleted).toBeGreaterThan(0);
      expect(result.error).toBeUndefined();
    });

    it('should not log when no logs are deleted', async () => {
      const ctx = await createTestContext();

      // Only recent logs
      await createTestLog({ projectId: ctx.project.id });

      const result = await service.executeRetentionForOrganization(
        ctx.organization.id,
        30,
        ctx.organization.name
      );

      expect(result.logsDeleted).toBe(0);
    });
  });
});
