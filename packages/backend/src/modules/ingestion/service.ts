import { db } from '../../database/index.js';
import { reservoir } from '../../database/reservoir.js';
import type { LogLevel as ReservoirLogLevel } from '@logtide/reservoir';
import type { LogInput } from '@logtide/shared';
import { createQueue } from '../../queue/connection.js';
import type { LogEntry } from '../sigma/detection-engine.js';
import { CacheManager } from '../../utils/cache.js';
import { notificationPublisher } from '../streaming/index.js';
import { correlationService, type IdentifierMatch } from '../correlation/service.js';
import { piiMaskingService } from '../pii-masking/service.js';
import { projectsService } from '../projects/service.js';
import { extractHostname } from './routes.js';
import { recordLogIngestion, metering } from '../metering/index.js';
import { assertWithinUsageQuota } from '../../capabilities/index.js';
import { context } from '@logtide/shared/context';
import { hooks, HookExecutionError } from '../../hooks/index.js';
import type { BeforeIngestContext } from '../../hooks/index.js';
import { hub } from '@logtide/core';
import { isInternalLoggingEnabled } from '../../utils/internal-logger.js';
import { createSkewTracker } from './skew.js';

export interface IngestRejection {
  /** Index of the record in the submitted batch. */
  index: number;
  reason: 'pii_masking_failed';
}

export interface IngestResult {
  received: number;
  rejected: IngestRejection[];
}

/**
 * Remove null characters (\u0000) that PostgreSQL doesn't support in text fields.
 */
function sanitizeForPostgres<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.replace(/\u0000/g, '') as T;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeForPostgres) as T;
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = sanitizeForPostgres(v);
    }
    return result as T;
  }
  return value;
}

export class IngestionService {
  /**
   * Ingest logs in batch
   */
  async ingestLogs(logs: LogInput[], projectId: string): Promise<IngestResult> {
    if (logs.length === 0) {
      return { received: 0, rejected: [] };
    }

    // Get project to find organization_id for custom patterns
    const project = await db
      .selectFrom('projects')
      .select(['organization_id'])
      .where('id', '=', projectId)
      .executeTakeFirst();

    const organizationId = project?.organization_id;

    // Extract identifiers from logs before insertion (using org-specific patterns)
    // Note: org_id and project_id are excluded from extraction to avoid storing useless data
    let identifiersByLog = new Map<number, IdentifierMatch[]>();
    for (let i = 0; i < logs.length; i++) {
      try {
        const identifiers = organizationId
          ? await correlationService.extractIdentifiersAsync(logs[i], organizationId, projectId)
          : correlationService.extractIdentifiers(logs[i], new Set([projectId.toLowerCase()]));
        if (identifiers.length > 0) {
          identifiersByLog.set(i, identifiers);
        }
      } catch (err) {
        // Don't fail ingestion if identifier extraction fails (enrichment, not safety)
        console.warn('[Ingestion] Failed to extract identifiers from log:', err);
        if (organizationId) {
          metering.record({
            type: 'ingestion.identifier_failed',
            quantity: 1,
            organizationId,
            projectId,
            metadata: { stage: 'extract' },
          });
        }
      }
    }

    // PII masking: apply before DB insert so sensitive data never touches disk.
    // Fail-closed (WS1): records whose masking fails are rejected, never stored.
    const rejected: IngestRejection[] = [];
    if (organizationId) {
      const failedIdx = await piiMaskingService.maskLogBatch(logs, organizationId, projectId);
      if (failedIdx.length > 0) {
        const failedSet = new Set(failedIdx);
        rejected.push(
          ...failedIdx.map((index) => ({ index, reason: 'pii_masking_failed' as const }))
        );

        const keptLogs: LogInput[] = [];
        const keptIdentifiers = new Map<number, IdentifierMatch[]>();
        logs.forEach((log, i) => {
          if (failedSet.has(i)) return;
          const ids = identifiersByLog.get(i);
          if (ids) keptIdentifiers.set(keptLogs.length, ids);
          keptLogs.push(log);
        });
        logs = keptLogs;
        identifiersByLog = keptIdentifiers;

        metering.record({
          type: 'ingestion.pii_rejected',
          quantity: rejected.length,
          organizationId,
          projectId,
        });
        if (isInternalLoggingEnabled()) {
          hub.captureLog('error', '[Ingestion] Rejected logs: PII masking failed', {
            organizationId,
            projectId,
            rejectedCount: rejected.length,
          });
        }

        if (logs.length === 0) {
          if (hooks.hasHandlers('afterIngest')) {
            void hooks.runAfter('afterIngest', {
              organizationId: organizationId ?? null,
              projectId,
              acceptedCount: 0,
              rejectedCount: rejected.length,
              rejectionReasons: [...new Set(rejected.map((r) => r.reason))],
            });
          }
          return { received: 0, rejected };
        }
      }
    }

    // Capability: hard-block ingestion when over a usage quota (#214).
    // Reads only the in-memory over-quota flag (no DB on the hot path).
    // Guarded: only assert when the request context org matches the project org; anonymous/missing-org ingestion is never blocked.
    if (organizationId && context.currentOrNull()?.organizationId === organizationId) {
      await assertWithinUsageQuota('ingestion.max_bytes_monthly');
      await assertWithinUsageQuota('ingestion.max_events_monthly');
      await assertWithinUsageQuota('storage.max_bytes');
    }

    // Convert logs to reservoir LogRecord format
    // Note: reservoir handles null byte sanitization internally
    // Clock skew (#279): observed inside the existing map so a large batch costs
    // one extra subtraction per record and one Date.now() per batch.
    const skewTracker = createSkewTracker(Date.now());
    let records: BeforeIngestContext['records'] = logs.map((log) => {
      // Extract hostname if not already set in metadata
      const hostname = log.metadata?.hostname || extractHostname(log);

      const metadata = {
        ...log.metadata,
        ...(hostname && { hostname }),
      };

      const hasMetadata = Object.keys(metadata).length > 0;

      const time = typeof log.time === 'string' ? new Date(log.time) : log.time;
      skewTracker.observe(time);

      return {
        time,
        projectId,
        service: sanitizeForPostgres(log.service),
        level: log.level as ReservoirLogLevel,
        message: sanitizeForPostgres(log.message),
        metadata: hasMetadata ? sanitizeForPostgres(metadata) : undefined,
        traceId: sanitizeForPostgres(log.trace_id) || undefined,
        spanId: sanitizeForPostgres((log as { span_id?: string }).span_id) || undefined,
        sessionId: sanitizeForPostgres((log as { session_id?: string }).session_id) || undefined,
      };
    });

    // Clock skew signal (#279). Fire-and-forget, never rejects: the records above
    // are written unchanged. Guarded on organizationId like the other ingestion
    // health counters, since anonymous ingestion has no org to attribute to.
    const skew = skewTracker.summary();
    if (skew && organizationId) {
      metering.record({
        type: 'ingestion.timestamp_skew',
        quantity: skew.count,
        organizationId,
        projectId,
        metadata: { maxPastMs: skew.maxPastMs, maxFutureMs: skew.maxFutureMs },
      });
    }

    // Lifecycle hook (#216): last interception point before the reservoir
    // write. Hooks may reject (throw) or mutate/replace `records`.
    // hasHandlers guard keeps the OSS no-hooks path at zero overhead
    // (no byteSize computation, no ctx allocation).
    if (hooks.hasHandlers('beforeIngest')) {
      const originalRecords = records.slice();
      const hookCtx: BeforeIngestContext = {
        organizationId: organizationId ?? null,
        projectId,
        eventCount: records.length,
        byteSize: Buffer.byteLength(JSON.stringify(records)),
        records,
      };
      await hooks.run('beforeIngest', hookCtx);
      records = hookCtx.records;

      // Tenancy guard: a hook must never move records across projects.
      // Fail closed rather than silently writing into another tenant.
      if (records.some((r) => r.projectId !== projectId)) {
        throw new HookExecutionError(
          'beforeIngest',
          new Error('beforeIngest hook changed record projectId')
        );
      }

      if (records.length === 0) {
        if (hooks.hasHandlers('afterIngest')) {
          void hooks.runAfter('afterIngest', {
            organizationId: organizationId ?? null,
            projectId,
            acceptedCount: 0,
            rejectedCount: rejected.length,
            rejectionReasons: [...new Set(rejected.map((r) => r.reason))],
          });
        }
        return { received: 0, rejected };
      }

      // Realign the original logs view and identifier indexes with the
      // (possibly filtered/reordered/replaced) records, so downstream
      // consumers that pair logs[i] with insertedLogs[i] (sigma, exception
      // parsing, pipelines, metering, correlation) never see phantom entries.
      const changed =
        records.length !== originalRecords.length ||
        records.some((r, i) => originalRecords[i] !== r);
      if (changed) {
        const indexByRecord = new Map(originalRecords.map((r, i) => [r, i]));
        const realignedLogs: LogInput[] = [];
        const realignedIdentifiers = new Map<number, IdentifierMatch[]>();
        records.forEach((r, newIndex) => {
          const originalIndex = indexByRecord.get(r);
          if (originalIndex !== undefined) {
            realignedLogs.push(logs[originalIndex]);
            const ids = identifiersByLog.get(originalIndex);
            if (ids) realignedIdentifiers.set(newIndex, ids);
          } else {
            // Hook-created record: synthesize a log view for downstream consumers
            realignedLogs.push({
              time: r.time,
              service: r.service,
              level: r.level,
              message: r.message,
              metadata: r.metadata,
              trace_id: r.traceId,
            } as LogInput);
          }
        });
        logs = realignedLogs;
        identifiersByLog = realignedIdentifiers;
      }
    }

    // Insert via reservoir (raw parametrized SQL with RETURNING *)
    const ingestResult = await reservoir.ingestReturning(records);
    const insertedLogs = ingestResult.rows.map((row: { id: string; time: Date; projectId: string; service: string; level: string; message: string; metadata?: Record<string, unknown>; traceId?: string; spanId?: string; sessionId?: string }) => ({
      id: row.id,
      time: row.time,
      project_id: row.projectId,
      service: row.service,
      level: row.level,
      message: row.message,
      metadata: row.metadata,
      trace_id: row.traceId,
      span_id: row.spanId,
      session_id: row.sessionId,
    }));

    // Store extracted identifiers (async, non-blocking)
    if (identifiersByLog.size > 0) {
      this.storeIdentifiers(insertedLogs, identifiersByLog, projectId).catch((err) => {
        console.error('[Ingestion] Failed to store identifiers:', err);
      });
    }

    // Trigger Sigma detection (async, non-blocking) with log IDs
    this.triggerSigmaDetection(logs, insertedLogs, projectId).catch((err) => {
      console.error('[Ingestion] Failed to trigger Sigma detection:', err);
    });

    // Trigger Exception parsing for error/critical logs (async, non-blocking)
    this.triggerExceptionParsing(logs, insertedLogs, projectId).catch((err) => {
      console.error('[Ingestion] Failed to trigger Exception parsing:', err);
    });

    // Trigger pipeline processing (async, non-blocking)
    if (organizationId) {
      this.triggerPipelineProcessing(logs, insertedLogs, projectId, organizationId).catch((err) => {
        console.error('[Ingestion] Failed to trigger pipeline processing:', err);
      });
    }

    // Mark the project as having logs (debounced in-memory, fire-and-forget)
    projectsService.markHasData(projectId, 'logs').catch(() => {});

    // Invalidate query caches for this project (async, non-blocking)
    CacheManager.invalidateProjectQueries(projectId).catch((err) => {
      console.error('[Ingestion] Failed to invalidate cache:', err);
    });

    // Publish notification for live tail (uses PostgreSQL LISTEN/NOTIFY)
    // Extract log IDs for the notification payload
    const logIds = insertedLogs.map((log) => log.id);
    notificationPublisher.publishLogIngestion(projectId, logIds).catch((err) => {
      console.error('[Ingestion] Failed to publish notification:', err);
    });

    // Record resource usage (#212). Fire-and-forget, never blocks ingestion.
    if (organizationId) {
      recordLogIngestion({
        logs,
        eventCount: insertedLogs.length,
        organizationId,
        projectId,
      });
    }

    if (hooks.hasHandlers('afterIngest')) {
      void hooks.runAfter('afterIngest', {
        organizationId: organizationId ?? null,
        projectId,
        acceptedCount: insertedLogs.length,
        rejectedCount: rejected.length,
        rejectionReasons: [...new Set(rejected.map((r) => r.reason))],
      });
    }

    return { received: insertedLogs.length, rejected };
  }

  /**
   * Store extracted identifiers for logs
   */
  private async storeIdentifiers(
    insertedLogs: any[],
    identifiersByLog: Map<number, IdentifierMatch[]>,
    projectId: string
  ): Promise<void> {
    try {
      // Get project to find organization_id
      const project = await db
        .selectFrom('projects')
        .select(['organization_id'])
        .where('id', '=', projectId)
        .executeTakeFirst();

      if (!project) {
        console.warn(`[Ingestion] Project not found for storing identifiers: ${projectId}`);
        return;
      }

      const logsWithContext = insertedLogs.map((log) => ({
        id: log.id,
        time: log.time,
        projectId: projectId,
        organizationId: project.organization_id,
      }));

      await correlationService.storeIdentifiers(logsWithContext, identifiersByLog);

      const totalIdentifiers = Array.from(identifiersByLog.values()).reduce(
        (sum, ids) => sum + ids.length,
        0
      );
      console.log(`[Ingestion] Stored ${totalIdentifiers} identifiers for ${identifiersByLog.size} logs`);
    } catch (error) {
      console.error('[Ingestion] Error storing identifiers:', error);
      if (isInternalLoggingEnabled()) {
        hub.captureLog('warn', '[Ingestion] Failed to store identifiers', {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      // Don't throw - ingestion should succeed even if identifier storage fails
    }
  }

  /**
   * Trigger Sigma detection job for ingested logs
   */
  private async triggerSigmaDetection(logs: LogInput[], insertedLogs: any[], projectId: string): Promise<void> {
    try {
      // Get project to find organization_id
      const project = await db
        .selectFrom('projects')
        .select(['organization_id'])
        .where('id', '=', projectId)
        .executeTakeFirst();

      if (!project) {
        console.warn(`[Ingestion] Project not found: ${projectId}`);
        return;
      }

      // Convert logs to LogEntry format for detection engine with IDs
      const logEntries: Array<LogEntry & { id: string }> = logs.map((log, index) => ({
        id: insertedLogs[index]?.id || '',
        service: log.service,
        level: log.level,
        message: log.message,
        metadata: log.metadata,
        trace_id: log.trace_id,
        time: log.time,
      }));

      // Queue Sigma detection job. One immediate retry; a second failure is
      // fail-open for a SIEM, so it must be loudly visible (WS1).
      const detectionQueue = createQueue('sigma-detection');
      const jobPayload = {
        logs: logEntries,
        organizationId: project.organization_id,
        projectId,
      };
      try {
        await detectionQueue.add('detect-logs', jobPayload);
      } catch {
        try {
          await detectionQueue.add('detect-logs', jobPayload);
        } catch (err) {
          metering.record({
            type: 'ingestion.detection_enqueue_failed',
            quantity: logEntries.length,
            organizationId: project.organization_id,
            projectId,
          });
          if (isInternalLoggingEnabled()) {
            hub.captureLog('error', '[Ingestion] Sigma detection enqueue failed after retry', {
              organizationId: project.organization_id,
              projectId,
              logCount: logEntries.length,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          console.error('[Ingestion] Sigma detection enqueue failed after retry:', err);
          return;
        }
      }

      console.log(`[Ingestion] Queued Sigma detection for ${logs.length} logs`);
    } catch (error) {
      console.error('[Ingestion] Error triggering Sigma detection:', error);
      // Don't throw - ingestion should succeed even if detection queueing fails
    }
  }

  /**
   * Trigger Exception parsing job for error/critical logs
   */
  private async triggerExceptionParsing(logs: LogInput[], insertedLogs: any[], projectId: string): Promise<void> {
    try {
      // Filter only error/critical logs
      const errorLogs = logs
        .map((log, index) => ({ log, inserted: insertedLogs[index] }))
        .filter(({ log }) => log.level === 'error' || log.level === 'critical')
        .map(({ log, inserted }) => ({
          id: inserted?.id || '',
          message: log.message,
          level: log.level as 'error' | 'critical',
          service: log.service,
          metadata: log.metadata,
        }));

      if (errorLogs.length === 0) {
        return;
      }

      // Get project to find organization_id
      const project = await db
        .selectFrom('projects')
        .select(['organization_id'])
        .where('id', '=', projectId)
        .executeTakeFirst();

      if (!project) {
        console.warn(`[Ingestion] Project not found for exception parsing: ${projectId}`);
        return;
      }

      // Queue exception parsing job. One immediate retry; second failure is
      // loudly visible (WS1).
      const exceptionQueue = createQueue('exception-parsing');
      const exceptionPayload = {
        logs: errorLogs,
        organizationId: project.organization_id,
        projectId,
      };
      try {
        await exceptionQueue.add('parse-exceptions', exceptionPayload);
      } catch {
        try {
          await exceptionQueue.add('parse-exceptions', exceptionPayload);
        } catch (err) {
          metering.record({
            type: 'ingestion.exception_enqueue_failed',
            quantity: errorLogs.length,
            organizationId: project.organization_id,
            projectId,
          });
          if (isInternalLoggingEnabled()) {
            hub.captureLog('error', '[Ingestion] Exception parsing enqueue failed after retry', {
              organizationId: project.organization_id,
              projectId,
              logCount: errorLogs.length,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          console.error('[Ingestion] Exception parsing enqueue failed after retry:', err);
          return;
        }
      }

      console.log(`[Ingestion] Queued exception parsing for ${errorLogs.length} error/critical logs`);
    } catch (error) {
      console.error('[Ingestion] Error triggering exception parsing:', error);
      // Don't throw - ingestion should succeed even if exception parsing queueing fails
    }
  }

  /**
   * Trigger log pipeline processing for ingested logs
   */
  private async triggerPipelineProcessing(
    logs: LogInput[],
    insertedLogs: any[],
    projectId: string,
    organizationId: string
  ): Promise<void> {
    try {
      const payload = logs.map((log: LogInput, i: number) => ({
        id: insertedLogs[i]?.id ?? '',
        time:
          insertedLogs[i]?.time instanceof Date
            ? insertedLogs[i].time.toISOString()
            : String(insertedLogs[i]?.time ?? new Date().toISOString()),
        message: log.message,
        metadata: (log.metadata as Record<string, unknown> | null | undefined) ?? null,
      }));

      const pipelineQueue = createQueue('log-pipeline');
      await pipelineQueue.add('process-pipeline', { logs: payload, projectId, organizationId });

      console.log(`[Ingestion] Queued pipeline processing for ${logs.length} logs`);
    } catch (error) {
      console.error('[Ingestion] Error queuing pipeline job:', error);
      // Don't throw - ingestion should succeed even if pipeline queueing fails
    }
  }

  /**
   * Get log statistics (reservoir: works with any engine)
   */
  async getStats(projectId: string, from?: Date, to?: Date) {
    const effectiveFrom = from || new Date(0);
    const effectiveTo = to || new Date();

    const topResult = await reservoir.topValues({
      field: 'level',
      projectId,
      from: effectiveFrom,
      to: effectiveTo,
      limit: 20, // enough for all log levels
    });

    const byLevel: Record<string, number> = {};
    let total = 0;
    for (const v of topResult.values) {
      byLevel[v.value] = v.count;
      total += v.count;
    }

    return { total, by_level: byLevel };
  }
}

export const ingestionService = new IngestionService();
