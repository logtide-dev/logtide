/**
 * Exception Parsing Job
 *
 * BullMQ job that parses stack traces from error/critical logs.
 * Triggered asynchronously after log ingestion.
 * Also queues error notifications for organization members.
 */

import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { ExceptionDetectionService } from '../../modules/exceptions/detection.js';
import { FingerprintService } from '../../modules/exceptions/fingerprint-service.js';
import { ExceptionService } from '../../modules/exceptions/service.js';
import { SourceMapUnminifier } from '../../modules/sourcemaps/unminify.js';
import { sourceMapsService } from '../../modules/sourcemaps/index.js';
import { errorNotificationQueue, type ErrorNotificationJobData } from './error-notification.js';
import type { IJob } from '../abstractions/types.js';

export interface ExceptionParsingJobData {
  logs: Array<{
    id: string;
    message: string;
    level: 'error' | 'critical';
    service: string;
    metadata?: Record<string, unknown>;
  }>;
  organizationId: string;
  projectId: string;
}

const exceptionService = new ExceptionService(db);
const unminifier = new SourceMapUnminifier(sourceMapsService);

/**
 * Process exception parsing job
 * Parses stack traces from error/critical logs and stores in database
 */
export async function processExceptionParsing(job: IJob<ExceptionParsingJobData>): Promise<void> {
  const { logs, organizationId, projectId } = job.data;

  console.log(`[ExceptionParsing] Processing ${logs.length} error/critical logs`);

  const stats = {
    parsed: 0,
    skipped: 0,
    errors: 0,
    alreadyExists: 0,
  };

  for (const log of logs) {
    try {
      const alreadyExists = await exceptionService.exceptionExists(log.id);
      if (alreadyExists) {
        stats.alreadyExists++;
        continue;
      }

      // Use detection service: tries structured metadata.exception first, then text parsing
      const parsed = ExceptionDetectionService.detectException(log.message, log.metadata);
      if (!parsed) {
        stats.skipped++;
        continue;
      }

      // Source map un-minification: resolve original locations if maps are available
      const release = log.metadata?.release as string | undefined;
      if (release && parsed.frames.length > 0) {
        try {
          await unminifier.unminifyFrames(parsed.frames, projectId, release);
        } catch (err) {
          console.warn(`[ExceptionParsing] Source map unminification failed for ${log.id}:`, err);
        }
      }

      const fingerprint = FingerprintService.generate(parsed);
      const topFrame = FingerprintService.topAppFrame(parsed);

      // Check if this is a new error group (first occurrence with this fingerprint)
      let existingGroup = await db
        .selectFrom('error_groups')
        .select(['id', 'occurrence_count', 'status'])
        .where('fingerprint', '=', fingerprint)
        .where('organization_id', '=', organizationId)
        .executeTakeFirst();

      // No exact fingerprint match: auto-merge into an existing group that shares
      // the coarse key (same type + normalized message + top app frame), so a
      // stack that differs only in its deep frames does not spawn a duplicate
      // group. The key is computed by the same Postgres function on both sides.
      let effectiveFingerprint = fingerprint;
      if (!existingGroup && topFrame) {
        const mergeMatch = await db
          .selectFrom('error_groups')
          .select(['id', 'fingerprint', 'occurrence_count', 'status'])
          .where('organization_id', '=', organizationId)
          .where('project_id', '=', projectId)
          .where(
            'merge_key',
            '=',
            sql<string>`logtide_merge_key(${parsed.exceptionType}, ${parsed.exceptionMessage}, ${topFrame})`
          )
          .orderBy('first_seen', 'asc')
          .executeTakeFirst();

        if (mergeMatch) {
          effectiveFingerprint = mergeMatch.fingerprint;
          existingGroup = {
            id: mergeMatch.id,
            occurrence_count: mergeMatch.occurrence_count,
            status: mergeMatch.status,
          };
        }
      }

      const isNewErrorGroup = !existingGroup;
      // A previously resolved error that recurs is a regression.
      const isRegression = existingGroup?.status === 'resolved';

      const exceptionId = await exceptionService.createException({
        organizationId,
        projectId,
        logId: log.id,
        parsedData: parsed,
        fingerprint: effectiveFingerprint,
        service: log.service,
        topFrame,
      });

      // Reopen a resolved group so the regression is visible and not silently
      // folded into a "resolved" bucket.
      if (isRegression && existingGroup) {
        await db
          .updateTable('error_groups')
          .set({ status: 'open', resolved_at: null, resolved_by: null, updated_at: new Date() })
          .where('id', '=', existingGroup.id)
          .execute();
      }

      stats.parsed++;

      console.log(
        `[ExceptionParsing] Parsed ${parsed.exceptionType} from ${log.service} ` +
        `(${parsed.frames.length} frames, fingerprint: ${fingerprint.substring(0, 8)}...)`
      );

      // Queue error notification (will be filtered by status in the notification job)
      try {
        const notificationData: ErrorNotificationJobData = {
          exceptionId,
          organizationId,
          projectId,
          fingerprint: effectiveFingerprint,
          exceptionType: parsed.exceptionType,
          exceptionMessage: parsed.exceptionMessage,
          language: parsed.language,
          service: log.service,
          isNewErrorGroup,
          isRegression,
        };

        await errorNotificationQueue.add('error-notification', notificationData, {
          // Delay by 2 seconds to ensure error group is fully created
          delay: 2000,
        });

        console.log(
          `[ExceptionParsing] Queued notification for ${isNewErrorGroup ? 'new' : 'existing'} error: ${parsed.exceptionType}`
        );
      } catch (notifyError) {
        // Don't fail the whole job if notification queueing fails
        console.error(`[ExceptionParsing] Failed to queue notification:`, notifyError);
      }
    } catch (error) {
      stats.errors++;
      console.error(`[ExceptionParsing] Error parsing log ${log.id}:`, error);
    }
  }

  console.log(
    `[ExceptionParsing] Completed: ` +
    `${stats.parsed} parsed, ${stats.skipped} skipped, ` +
    `${stats.alreadyExists} already exists, ${stats.errors} errors`
  );
}
