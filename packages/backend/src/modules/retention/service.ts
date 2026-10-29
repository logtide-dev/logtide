import { db } from '../../database/connection.js';
import { sql } from 'kysely';
import { reservoir } from '../../database/reservoir.js';
import { isInternalLoggingEnabled } from '../../utils/internal-logger.js';
import { hub } from '@logtide/core';
import { auditLogService } from '../audit-log/index.js';

// ============================================================================
// Types
// ============================================================================

// ============================================================================
// Audit Retention Types
// ============================================================================

export interface AuditRetentionSummary {
  totalOrganizations: number;
  totalEntriesDeleted: number;
  results: { organizationId: string; entriesDeleted: number; error?: string }[];
}

// ============================================================================
// Log Retention Types
// ============================================================================

export interface RetentionExecutionResult {
  organizationId: string;
  organizationName: string;
  retentionDays: number;
  logsDeleted: number;
  executionTimeMs: number;
  error?: string;
}

export interface RetentionExecutionSummary {
  totalOrganizations: number;
  successfulOrganizations: number;
  failedOrganizations: number;
  totalLogsDeleted: number;
  totalExecutionTimeMs: number;
  results: RetentionExecutionResult[];
}

export interface OrganizationRetentionStatus {
  organizationId: string;
  organizationName: string;
  retentionDays: number;
  oldestLogTime: Date | null;
  totalLogs: number;
  logsToDelete: number;
  estimatedDeletionDate: Date | null;
}

// ============================================================================
// Retention Service
// ============================================================================

export class RetentionService {
  /**
   * Validate retention days value
   */
  validateRetentionDays(days: number): { valid: boolean; error?: string } {
    if (!Number.isInteger(days)) {
      return { valid: false, error: 'Retention days must be an integer' };
    }
    if (days < 1) {
      return { valid: false, error: 'Retention days must be at least 1' };
    }
    if (days > 365) {
      return { valid: false, error: 'Retention days cannot exceed 365' };
    }
    return { valid: true };
  }

  /**
   * Update retention days for an organization (admin only)
   */
  async updateOrganizationRetention(
    organizationId: string,
    retentionDays: number
  ): Promise<{ success: boolean; retentionDays: number }> {
    const validation = this.validateRetentionDays(retentionDays);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Get current value for audit logging
    const currentOrg = await db
      .selectFrom('organizations')
      .select(['name', 'retention_days'])
      .where('id', '=', organizationId)
      .executeTakeFirst();

    if (!currentOrg) {
      throw new Error('Organization not found');
    }

    const oldValue = currentOrg.retention_days;

    // Update retention days
    await db
      .updateTable('organizations')
      .set({
        retention_days: retentionDays,
        updated_at: new Date(),
      })
      .where('id', '=', organizationId)
      .execute();

    // Audit log
    /* v8 ignore next 7 -- telemetry, disabled in tests */
    if (isInternalLoggingEnabled() && oldValue !== retentionDays) {
      hub.captureLog('info', `Retention policy changed for ${currentOrg.name}`, {
        organizationId,
        organizationName: currentOrg.name,
        oldRetentionDays: oldValue,
        newRetentionDays: retentionDays,
      });
    }

    return { success: true, retentionDays };
  }

  /**
   * Get retention status for an organization
   */
  async getOrganizationRetentionStatus(organizationId: string): Promise<OrganizationRetentionStatus> {
    // Get organization info
    const org = await db
      .selectFrom('organizations')
      .select(['id', 'name', 'retention_days'])
      .where('id', '=', organizationId)
      .executeTakeFirst();

    if (!org) {
      throw new Error('Organization not found');
    }

    // Get project IDs for this organization
    const projects = await db
      .selectFrom('projects')
      .select('id')
      .where('organization_id', '=', organizationId)
      .execute();

    const projectIds = projects.map((p) => p.id);

    if (projectIds.length === 0) {
      return {
        organizationId: org.id,
        organizationName: org.name,
        retentionDays: org.retention_days,
        oldestLogTime: null,
        totalLogs: 0,
        logsToDelete: 0,
        estimatedDeletionDate: null,
      };
    }

    const cutoffDate = new Date(Date.now() - org.retention_days * 24 * 60 * 60 * 1000);
    const now = new Date();

    // Reservoir: oldest log, total count, to-delete count (works with any engine)
    const [oldestResult, totalLogsResult, toDeleteResult] = await Promise.all([
      reservoir.query({ projectId: projectIds, from: new Date(0), to: now, limit: 1, sortOrder: 'asc' }),
      reservoir.count({ projectId: projectIds, from: new Date(0), to: now }),
      reservoir.count({ projectId: projectIds, from: new Date(0), to: cutoffDate }),
    ]);

    // Calculate when logs will start being deleted (oldest log time + retention days)
    const oldestLog = oldestResult.logs.length > 0 ? oldestResult.logs[0] : null;
    let estimatedDeletionDate: Date | null = null;
    if (oldestLog?.time) {
      const oldestTime = new Date(oldestLog.time);
      estimatedDeletionDate = new Date(oldestTime.getTime() + org.retention_days * 24 * 60 * 60 * 1000);
      // If the deletion date is in the past, logs would be deleted on next cleanup
      if (estimatedDeletionDate < new Date()) {
        estimatedDeletionDate = new Date(); // Next cleanup
      }
    }

    return {
      organizationId: org.id,
      organizationName: org.name,
      retentionDays: org.retention_days,
      oldestLogTime: oldestLog?.time ? new Date(oldestLog.time) : null,
      totalLogs: totalLogsResult.count,
      logsToDelete: toDeleteResult.count,
      estimatedDeletionDate,
    };
  }

  /**
   * Update the retention policy (log and/or audit retention) of an organization
   * and record the audit entry. Shared by the admin route and extensions.
   */
  async setOrganizationRetentionPolicy(
    organizationId: string,
    input: { retentionDays?: number; auditRetentionDays?: number | null },
    actor?: string
  ): Promise<Record<string, unknown>> {
    if (input.retentionDays === undefined && input.auditRetentionDays === undefined) {
      throw new Error('At least one of retentionDays or auditRetentionDays is required');
    }

    const response: Record<string, unknown> = {
      message: 'Retention policy updated successfully',
    };

    if (input.retentionDays !== undefined) {
      const result = await this.updateOrganizationRetention(organizationId, input.retentionDays);
      Object.assign(response, result);
    }

    if (input.auditRetentionDays !== undefined) {
      const auditResult = await this.updateOrganizationAuditRetention(organizationId, input.auditRetentionDays);
      response.auditRetentionDays = auditResult.auditRetentionDays;
    }

    await auditLogService.record({
      action: 'org.retention_updated',
      organizationId,
      target: { type: 'organization', id: organizationId },
      metadata: {
        ...(actor ? { actor } : {}),
        ...(input.retentionDays !== undefined ? { retentionDays: input.retentionDays } : {}),
        ...(input.auditRetentionDays !== undefined ? { auditRetentionDays: input.auditRetentionDays } : {}),
      },
    });

    return response;
  }

  /**
   * Retention status plus the audit retention window of an organization.
   */
  async getOrganizationRetentionPolicy(organizationId: string): Promise<Record<string, unknown>> {
    const [status, org] = await Promise.all([
      this.getOrganizationRetentionStatus(organizationId),
      // audit_retention_days is fetched alongside (not in getOrganizationRetentionStatus to stay backward-compat)
      db
        .selectFrom('organizations')
        .select('audit_retention_days')
        .where('id', '=', organizationId)
        .executeTakeFirst(),
    ]);
    return { ...status, auditRetentionDays: org?.audit_retention_days ?? null };
  }

  // Time window size for batch deletes (1 day keeps each DELETE small)
  private static readonly BATCH_WINDOW_MS = 24 * 60 * 60 * 1000;

  /**
   * Delete logs for given project IDs older than cutoffDate using daily time windows.
   * Each window deletes at most 1 day of data, keeping CPU/memory bounded.
   * Uses reservoir.deleteByTimeRange() - works with any engine.
   *
   * Note: On ClickHouse, mutations are async so `result.deleted` returns 0
   * immediately. The actual deletion happens in the background.
   */
  private async batchDeleteLogs(projectIds: string[], cutoffDate: Date, rangeStart: Date): Promise<number> {
    let totalDeleted = 0;
    const windowMs = RetentionService.BATCH_WINDOW_MS;

    let windowStart = rangeStart;
    while (windowStart < cutoffDate) {
      const windowEnd = new Date(Math.min(windowStart.getTime() + windowMs, cutoffDate.getTime()));

      const result = await reservoir.deleteByTimeRange({
        projectId: projectIds,
        from: windowStart,
        to: windowEnd,
      });

      totalDeleted += result.deleted;
      windowStart = windowEnd;
    }

    return totalDeleted;
  }

  /**
   * Execute retention cleanup for a single organization.
   * Used by the admin manual trigger endpoint.
   */
  async executeRetentionForOrganization(
    organizationId: string,
    retentionDays: number,
    organizationName: string
  ): Promise<RetentionExecutionResult> {
    const startTime = Date.now();

    try {
      const projects = await db
        .selectFrom('projects')
        .select('id')
        .where('organization_id', '=', organizationId)
        .execute();

      const projectIds = projects.map((p) => p.id);

      if (projectIds.length === 0) {
        return {
          organizationId,
          organizationName,
          retentionDays,
          logsDeleted: 0,
          executionTimeMs: Date.now() - startTime,
        };
      }

      const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      // Find oldest log to know where to start the batch window (reservoir: works with any engine)
      const oldestResult = await reservoir.query({
        projectId: projectIds,
        from: new Date(0),
        to: cutoffDate,
        limit: 1,
        sortOrder: 'asc',
      });

      let totalDeleted = 0;
      if (oldestResult.logs.length > 0) {
        totalDeleted = await this.batchDeleteLogs(projectIds, cutoffDate, new Date(oldestResult.logs[0].time));
      }
      const executionTimeMs = Date.now() - startTime;

      /* v8 ignore next 8 -- telemetry, disabled in tests */
      if (totalDeleted > 0 && isInternalLoggingEnabled()) {
        hub.captureLog('info', `Deleted ${totalDeleted} logs for ${organizationName}`, {
          organizationId,
          organizationName,
          retentionDays,
          logsDeleted: totalDeleted,
          executionTimeMs,
        });
      }

      return {
        organizationId,
        organizationName,
        retentionDays,
        logsDeleted: totalDeleted,
        executionTimeMs,
      };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      /* v8 ignore next 7 -- telemetry, disabled in tests */
      if (isInternalLoggingEnabled()) {
        hub.captureLog('error', `Failed to cleanup logs for ${organizationName}: ${errorMessage}`, {
          organizationId,
          organizationName,
          retentionDays,
          error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) },
        });
      }

      return {
        organizationId,
        organizationName,
        retentionDays,
        logsDeleted: 0,
        executionTimeMs,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute retention cleanup for all organizations.
   *
   * Strategy (scales with number of distinct retention values, not orgs):
   * 1. drop_chunks for max retention - instant, drops entire files
   * 2. Group orgs by retention_days, collect all project_ids per group
   * 3. For each group with retention < max: batch-delete their logs
   */
  async executeRetentionForAllOrganizations(): Promise<RetentionExecutionSummary> {
    const startTime = Date.now();
    const logging = isInternalLoggingEnabled();

    // Get all organizations with their retention + projects
    const organizations = await db
      .selectFrom('organizations')
      .select(['id', 'name', 'retention_days'])
      .execute();

    const orgProjects = await db
      .selectFrom('projects')
      .select(['id', 'organization_id'])
      .execute();

    // Build org -> projectIds map
    const projectsByOrg = new Map<string, string[]>();
    for (const p of orgProjects) {
      const list = projectsByOrg.get(p.organization_id) || [];
      list.push(p.id);
      projectsByOrg.set(p.organization_id, list);
    }

    // Early return if no organizations exist
    if (organizations.length === 0) {
      return {
        totalOrganizations: 0,
        successfulOrganizations: 0,
        failedOrganizations: 0,
        totalLogsDeleted: 0,
        totalExecutionTimeMs: Date.now() - startTime,
        results: [],
      };
    }

    // Find max retention (used for drop_chunks)
    const maxRetention = Math.max(...organizations.map(o => o.retention_days));
    const maxCutoff = new Date(Date.now() - maxRetention * 24 * 60 * 60 * 1000);

    // Step 1: drop_chunks older than max retention (TimescaleDB only - instant, no decompression)
    // For ClickHouse, TTL policies handle this natively or deleteByTimeRange in step 3
    let chunksDropped = 0;
    if (reservoir.getEngineType() === 'timescale') {
      try {
        const dropResult = await sql`
          SELECT drop_chunks('logs', older_than => ${maxCutoff}::timestamptz)
        `.execute(db);
        chunksDropped = dropResult.rows.length;

        /* v8 ignore next 6 -- telemetry, disabled in tests */
        if (chunksDropped > 0 && logging) {
          hub.captureLog('info', `Dropped ${chunksDropped} chunks older than ${maxRetention} days`, {
            maxRetentionDays: maxRetention,
            cutoffDate: maxCutoff.toISOString(),
            chunksDropped,
          });
        }
      } catch (err) {
        // drop_chunks may fail if no chunks to drop - that's fine
        /* v8 ignore next 4 -- telemetry, disabled in tests */
        if (logging) {
          const msg = err instanceof Error ? err.message : String(err);
          hub.captureLog('debug', `drop_chunks: ${msg}`);
        }
      }
    }

    // Step 2: Group orgs by retention_days (only those with retention < max need per-row deletes)
    const retentionGroups = new Map<number, { orgs: typeof organizations; projectIds: string[] }>();
    for (const org of organizations) {
      if (org.retention_days >= maxRetention) continue; // already handled by drop_chunks

      const group = retentionGroups.get(org.retention_days) || { orgs: [], projectIds: [] };
      group.orgs.push(org);
      const orgProjectIds = projectsByOrg.get(org.id) || [];
      group.projectIds.push(...orgProjectIds);
      retentionGroups.set(org.retention_days, group);
    }

    // Step 3: Batch-delete per retention group
    const results: RetentionExecutionResult[] = [];
    let totalDeleted = 0;
    let failedCount = 0;

    for (const [retentionDays, group] of retentionGroups) {
      if (group.projectIds.length === 0) {
        // No projects in this group - mark all orgs as success with 0 deleted
        for (const org of group.orgs) {
          results.push({
            organizationId: org.id,
            organizationName: org.name,
            retentionDays,
            logsDeleted: 0,
            executionTimeMs: 0,
          });
        }
        continue;
      }

      const groupStart = Date.now();
      const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      try {
        // Find oldest log in this group to know where to start batching (reservoir: works with any engine)
        const oldestResult = await reservoir.query({
          projectId: group.projectIds,
          from: new Date(0),
          to: cutoffDate,
          limit: 1,
          sortOrder: 'asc',
        });

        if (oldestResult.logs.length === 0) {
          // No logs to delete in this group
          for (const org of group.orgs) {
            results.push({
              organizationId: org.id,
              organizationName: org.name,
              retentionDays,
              logsDeleted: 0,
              executionTimeMs: Date.now() - groupStart,
            });
          }
          continue;
        }

        const deleted = await this.batchDeleteLogs(group.projectIds, cutoffDate, new Date(oldestResult.logs[0].time));
        const groupTime = Date.now() - groupStart;
        totalDeleted += deleted;

        /* v8 ignore next 7 -- telemetry, disabled in tests */
        if (deleted > 0 && logging) {
          hub.captureLog('info', `Deleted ${deleted} logs for ${group.orgs.length} orgs (${retentionDays}d retention) in ${groupTime}ms`, {
            retentionDays,
            orgCount: group.orgs.length,
            logsDeleted: deleted,
            executionTimeMs: groupTime,
          });
        }

        // Report per-org (split evenly for reporting - exact per-org count isn't available in group mode)
        for (const org of group.orgs) {
          results.push({
            organizationId: org.id,
            organizationName: org.name,
            retentionDays,
            logsDeleted: deleted, // group total (not per-org, but accurate for billing/reporting)
            executionTimeMs: groupTime,
          });
        }
      } catch (error) {
        const groupTime = Date.now() - groupStart;
        const errorMessage = error instanceof Error ? error.message : String(error);
        failedCount += group.orgs.length;

        /* v8 ignore next 6 -- telemetry, disabled in tests */
        if (logging) {
          hub.captureLog('error', `Failed retention for ${retentionDays}d group: ${errorMessage}`, {
            retentionDays,
            orgCount: group.orgs.length,
            error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) },
          });
        }

        for (const org of group.orgs) {
          results.push({
            organizationId: org.id,
            organizationName: org.name,
            retentionDays,
            logsDeleted: 0,
            executionTimeMs: groupTime,
            error: errorMessage,
          });
        }
      }
    }

    // Add results for orgs at max retention (handled by drop_chunks, 0 row-level deletes)
    for (const org of organizations) {
      if (org.retention_days >= maxRetention) {
        results.push({
          organizationId: org.id,
          organizationName: org.name,
          retentionDays: org.retention_days,
          logsDeleted: 0,
          executionTimeMs: 0,
        });
      }
    }

    const successCount = organizations.length - failedCount;
    const totalExecutionTimeMs = Date.now() - startTime;

    /* v8 ignore next 11 -- telemetry, disabled in tests */
    if (logging) {
      hub.captureLog('info', 'Retention cleanup completed', {
        totalOrganizations: organizations.length,
        successfulOrganizations: successCount,
        failedOrganizations: failedCount,
        totalLogsDeleted: totalDeleted,
        chunksDropped,
        retentionGroups: retentionGroups.size,
        totalExecutionTimeMs,
      });
    }

    return {
      totalOrganizations: organizations.length,
      successfulOrganizations: successCount,
      failedOrganizations: failedCount,
      totalLogsDeleted: totalDeleted,
      totalExecutionTimeMs,
      results,
    };
  }

  // ============================================================================
  // Audit Log Retention
  // ============================================================================

  /**
   * Validate audit retention days value (1..3650 or null for keep-forever)
   */
  validateAuditRetentionDays(days: number | null): { valid: boolean; error?: string } {
    if (days === null) return { valid: true };
    if (!Number.isInteger(days)) return { valid: false, error: 'Audit retention days must be an integer' };
    if (days < 1) return { valid: false, error: 'Audit retention days must be at least 1' };
    if (days > 3650) return { valid: false, error: 'Audit retention days cannot exceed 3650' };
    return { valid: true };
  }

  /**
   * Update audit log retention policy for an organization (admin only).
   * Pass null to revert to keep-forever (no expiry).
   */
  async updateOrganizationAuditRetention(
    organizationId: string,
    auditRetentionDays: number | null
  ): Promise<{ success: boolean; auditRetentionDays: number | null }> {
    const validation = this.validateAuditRetentionDays(auditRetentionDays);
    if (!validation.valid) throw new Error(validation.error);

    const org = await db
      .selectFrom('organizations')
      .select(['id'])
      .where('id', '=', organizationId)
      .executeTakeFirst();

    if (!org) throw new Error('Organization not found');

    await db
      .updateTable('organizations')
      .set({ audit_retention_days: auditRetentionDays, updated_at: new Date() })
      .where('id', '=', organizationId)
      .execute();

    return { success: true, auditRetentionDays };
  }

  /**
   * Delete audit_log entries older than each org's audit_retention_days window.
   * Only orgs with a non-null audit_retention_days are processed.
   * audit_log is a Postgres/TimescaleDB control-plane table; deleted with plain SQL.
   */
  async executeAuditRetentionForAllOrganizations(): Promise<AuditRetentionSummary> {
    const orgs = await db
      .selectFrom('organizations')
      .select(['id', 'audit_retention_days'])
      .where('audit_retention_days', 'is not', null)
      .execute();

    const results: AuditRetentionSummary['results'] = [];
    let total = 0;

    for (const org of orgs) {
      try {
        const res = await sql<{ count: string }>`
          WITH deleted AS (
            DELETE FROM audit_log
            WHERE organization_id = ${org.id}
              AND time < NOW() - make_interval(days => ${org.audit_retention_days})
            RETURNING 1
          ) SELECT COUNT(*)::text AS count FROM deleted
        `.execute(db);
        const deleted = Number(res.rows[0]?.count ?? 0);
        total += deleted;
        results.push({ organizationId: org.id, entriesDeleted: deleted });
      } catch (err) {
        results.push({ organizationId: org.id, entriesDeleted: 0, error: (err as Error).message });
      }
    }

    return { totalOrganizations: orgs.length, totalEntriesDeleted: total, results };
  }
}

export const retentionService = new RetentionService();
