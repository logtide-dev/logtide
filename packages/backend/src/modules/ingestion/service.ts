import { db } from '../../database/index.js';
import type { LogInput } from '@logtide/shared';
import { createQueue } from '../../queue/connection.js';
import type { LogEntry } from '../sigma/detection-engine.js';
import { CacheManager } from '../../utils/cache.js';
import { notificationPublisher } from '../streaming/index.js';

export class IngestionService {
  /**
   * Ingest logs in batch
   */
  async ingestLogs(logs: LogInput[], projectId: string): Promise<number> {
    if (logs.length === 0) {
      return 0;
    }

    // Convert logs to database format
    const dbLogs = logs.map((log) => ({
      time: typeof log.time === 'string' ? new Date(log.time) : log.time,
      project_id: projectId,
      service: log.service,
      level: log.level,
      message: log.message,
      metadata: log.metadata || null,
      trace_id: log.trace_id || null,
      span_id: (log as { span_id?: string }).span_id || null,
    }));

    // Insert logs in batch and return IDs
    const insertedLogs = await db
      .insertInto('logs')
      .values(dbLogs)
      .returningAll()
      .execute();

    // Trigger Sigma detection (async, non-blocking) with log IDs
    this.triggerSigmaDetection(logs, insertedLogs, projectId).catch((err) => {
      console.error('[Ingestion] Failed to trigger Sigma detection:', err);
    });

    // Trigger Exception parsing for error/critical logs (async, non-blocking)
    this.triggerExceptionParsing(logs, insertedLogs, projectId).catch((err) => {
      console.error('[Ingestion] Failed to trigger Exception parsing:', err);
    });

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

    return logs.length;
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

      // Queue Sigma detection job
      const detectionQueue = createQueue('sigma-detection');

      await detectionQueue.add('detect-logs', {
        logs: logEntries,
        organizationId: project.organization_id,
        projectId,
      });

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

      // Queue exception parsing job
      const exceptionQueue = createQueue('exception-parsing');

      await exceptionQueue.add('parse-exceptions', {
        logs: errorLogs,
        organizationId: project.organization_id,
        projectId,
      });

      console.log(`[Ingestion] Queued exception parsing for ${errorLogs.length} error/critical logs`);
    } catch (error) {
      console.error('[Ingestion] Error triggering exception parsing:', error);
      // Don't throw - ingestion should succeed even if exception parsing queueing fails
    }
  }

  /**
   * Get log statistics
   */
  async getStats(projectId: string, from?: Date, to?: Date) {
    const query = db
      .selectFrom('logs')
      .select([
        db.fn.count('time').as('total'),
        'level',
      ])
      .where('project_id', '=', projectId)
      .groupBy('level');

    if (from) {
      query.where('time', '>=', from);
    }

    if (to) {
      query.where('time', '<=', to);
    }

    const results = await query.execute();

    return {
      total: results.reduce((sum, r) => sum + Number(r.total), 0),
      by_level: results.reduce((acc, r) => {
        acc[r.level] = Number(r.total);
        return acc;
      }, {} as Record<string, number>),
    };
  }
}

export const ingestionService = new IngestionService();
