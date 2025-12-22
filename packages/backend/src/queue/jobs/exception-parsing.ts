/**
 * Exception Parsing Job
 *
 * BullMQ job that parses stack traces from error/critical logs.
 * Triggered asynchronously after log ingestion.
 * Also queues error notifications for organization members.
 */

import { db } from '../../database/connection.js';
import { ParserFactory } from '../../modules/exceptions/parsers/parser-factory.js';
import { FingerprintService } from '../../modules/exceptions/fingerprint-service.js';
import { ExceptionService } from '../../modules/exceptions/service.js';
import { errorNotificationQueue, type ErrorNotificationJobData } from './error-notification.js';
import type { Job } from 'bullmq';

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

/**
 * Process exception parsing job
 * Parses stack traces from error/critical logs and stores in database
 */
export async function processExceptionParsing(job: Job<ExceptionParsingJobData>): Promise<void> {
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

      const parsed = ParserFactory.parse(log.message);
      if (!parsed) {
        stats.skipped++;
        continue;
      }

      const fingerprint = FingerprintService.generate(parsed);

      // Check if this is a new error group (first occurrence with this fingerprint)
      const existingGroup = await db
        .selectFrom('error_groups')
        .select(['id', 'occurrence_count', 'status'])
        .where('fingerprint', '=', fingerprint)
        .where('organization_id', '=', organizationId)
        .executeTakeFirst();

      const isNewErrorGroup = !existingGroup;

      const exceptionId = await exceptionService.createException({
        organizationId,
        projectId,
        logId: log.id,
        parsedData: parsed,
        fingerprint,
      });

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
          fingerprint,
          exceptionType: parsed.exceptionType,
          exceptionMessage: parsed.exceptionMessage,
          language: parsed.language,
          service: log.service,
          isNewErrorGroup,
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
