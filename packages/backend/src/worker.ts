import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { context } from '@logtide/shared/context';
import { createWorker, startQueueWorkers, shutdownQueueSystem, getQueueBackend } from './queue/connection.js';
import { loadExternalHooks } from './hooks/index.js';
import { processAlertNotification, type AlertNotificationData } from './queue/jobs/alert-notification.js';
import { processSigmaDetection, type SigmaDetectionData } from './queue/jobs/sigma-detection.js';
import { processIncidentAutoGrouping } from './queue/jobs/incident-autogrouping.js';
import { processInvitationEmail, type InvitationEmailData } from './queue/jobs/invitation-email.js';
import { processIncidentNotification, type IncidentNotificationJob } from './queue/jobs/incident-notification.js';
import { processExceptionParsing, type ExceptionParsingJobData } from './queue/jobs/exception-parsing.js';
import { processErrorNotification, type ErrorNotificationJobData } from './queue/jobs/error-notification.js';
import { processMonitorNotification, type MonitorNotificationJob } from './queue/jobs/monitor-notification.js';
import { processLogPipeline, type LogPipelineJobData } from './queue/jobs/log-pipeline.js';
import { processDigestGeneration } from './queue/jobs/digest-generation.js';
import type { DigestJobPayload } from './modules/digests/scheduler.js';
import { processWebhookDelivery } from './queue/jobs/webhook-delivery.js';
import type { WebhookDeliveryJobData } from './modules/webhooks/types.js';
import { alertsService } from './modules/alerts/index.js';
import { monitorService } from './modules/monitoring/index.js';
import { maintenanceService } from './modules/maintenances/service.js';
import { enrichmentService } from './modules/siem/enrichment-service.js';
import { retentionService } from './modules/retention/index.js';
import { auditLogService } from './modules/audit-log/index.js';
import { sigmaSyncService } from './modules/sigma/sync-service.js';
// Email digest feature is incomplete and disabled for 1.0.0-beta (see #154 below).
// import { digestScheduler } from './modules/digests/scheduler.js';
import { initializeWorkerLogging, shutdownInternalLogging, isInternalLoggingEnabled } from './utils/internal-logger.js';
import { hub } from '@logtide/core';
import { reservoirReady } from './database/reservoir.js';
import { db } from './database/connection.js';

// Initialize internal logging via @logtide/core hub
await initializeWorkerLogging();

// Wait for reservoir to be ready before processing jobs that need it
await reservoirReady;

await loadExternalHooks();

// Initialize enrichment services (downloads GeoLite2 if missing)
await enrichmentService.initialize();

// Create worker for alert notifications
const alertWorker = createWorker<AlertNotificationData>('alert-notifications', async (job) => {
  await processAlertNotification(job);
});

// Create worker for Sigma detection
const sigmaWorker = createWorker<SigmaDetectionData>('sigma-detection', async (job) => {
  await processSigmaDetection(job);
});

// Create worker for incident auto-grouping
const autoGroupWorker = createWorker('incident-autogrouping', async (job) => {
  await processIncidentAutoGrouping(job);
});

// Create worker for invitation emails
const invitationWorker = createWorker<InvitationEmailData>('invitation-email', async (job) => {
  await processInvitationEmail(job);
});

// Create worker for incident notifications
const incidentNotificationWorker = createWorker<IncidentNotificationJob>('incident-notifications', async (job) => {
  await processIncidentNotification(job);
});

// Create worker for exception parsing
const exceptionWorker = createWorker<ExceptionParsingJobData>('exception-parsing', async (job) => {
  await processExceptionParsing(job);
});

// Create worker for error notifications
const errorNotificationWorker = createWorker<ErrorNotificationJobData>('error-notifications', async (job) => {
  await processErrorNotification(job);
});

// Create worker for monitor notifications
const monitorNotificationWorker = createWorker<MonitorNotificationJob>('monitor-notifications', async (job) => {
  await processMonitorNotification(job);
});

// Create worker for log pipeline processing
const pipelineWorker = createWorker<LogPipelineJobData>('log-pipeline', async (job) => {
  await processLogPipeline(job);
});

// Create worker for digest generation
const digestWorker = createWorker<DigestJobPayload>('digest-generation', async (job) => {
  await processDigestGeneration(job);
});
// The email digest reports feature (#154) is incomplete: it only summarizes log
// volume (no error groups, security or uptime sections, no HTML layout) and has no
// UI to configure it. The scheduler is intentionally left unregistered so no partial
// digests are ever sent in the 1.0.0-beta release. The worker, service, database
// schema and tests stay in place so the remaining scope can be finished under #154.
// await digestScheduler.registerAllDigests();

// Create worker for outbound webhook delivery (#218)
const webhookDeliveryWorker = createWorker<WebhookDeliveryJobData>('webhook-delivery', async (job) => {
  await processWebhookDelivery(job);
});

// Start workers (required for graphile-worker backend, no-op for BullMQ)
console.log(`[Worker] Using queue backend: ${getQueueBackend()}`);
await startQueueWorkers();

// Print startup banner
try {
  const __workerDirname = path.dirname(fileURLToPath(import.meta.url));
  const banner = readFileSync(path.resolve(__workerDirname, '../ascii.txt'), 'utf-8');
  console.log(banner);
} catch { /* ascii art file missing, skip */ }

const workerPkg = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf-8'));
console.log(`  LogTide Worker v${workerPkg.version} started\n`);
console.log('[Worker] All workers started');

alertWorker.on('completed', (job) => {
  if (isInternalLoggingEnabled()) {
    hub.captureLog('info', `Alert notification job completed`, {
      jobId: job.id,
      alertRuleId: job.data?.rule_id,
      logCount: job.data?.log_count,
    });
  }
});

alertWorker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);

  if (isInternalLoggingEnabled()) {
    hub.captureLog('error', `Alert notification job failed: ${err.message}`, {
      error: { name: err.name, message: err.message, stack: err.stack },
      jobId: job?.id,
      alertRuleId: job?.data?.rule_id,
    });
  }
});

sigmaWorker.on('completed', (job) => {
  if (isInternalLoggingEnabled()) {
    hub.captureLog('info', `Sigma detection job completed`, {
      jobId: job.id,
      logCount: job.data?.logs?.length,
    });
  }
});

sigmaWorker.on('failed', (job, err) => {
  console.error(`Sigma detection job ${job?.id} failed:`, err);

  if (isInternalLoggingEnabled()) {
    hub.captureLog('error', `Sigma detection job failed: ${err.message}`, {
      error: { name: err.name, message: err.message, stack: err.stack },
      jobId: job?.id,
      logCount: job?.data?.logs?.length,
    });
  }
});

autoGroupWorker.on('completed', (job) => {
  if (isInternalLoggingEnabled()) {
    hub.captureLog('info', `Incident auto-grouping job completed`, {
      jobId: job.id,
    });
  }
});

autoGroupWorker.on('failed', (job, err) => {
  console.error(`Incident auto-grouping job ${job?.id} failed:`, err);

  if (isInternalLoggingEnabled()) {
    hub.captureLog('error', `Incident auto-grouping job failed: ${err.message}`, {
      error: { name: err.name, message: err.message, stack: err.stack },
      jobId: job?.id,
    });
  }
});

invitationWorker.on('completed', (job) => {
  if (isInternalLoggingEnabled()) {
    hub.captureLog('info', `Invitation email job completed`, {
      jobId: job.id,
      email: job.data?.email,
    });
  }
});

invitationWorker.on('failed', (job, err) => {
  console.error(`Invitation email job ${job?.id} failed:`, err);

  if (isInternalLoggingEnabled()) {
    hub.captureLog('error', `Invitation email job failed: ${err.message}`, {
      error: { name: err.name, message: err.message, stack: err.stack },
      jobId: job?.id,
      email: job?.data?.email,
    });
  }
});

incidentNotificationWorker.on('completed', (job) => {
  if (isInternalLoggingEnabled()) {
    hub.captureLog('info', `Incident notification job completed`, {
      jobId: job.id,
      incidentId: job.data?.incidentId,
    });
  }
});

incidentNotificationWorker.on('failed', (job, err) => {
  console.error(`Incident notification job ${job?.id} failed:`, err);

  if (isInternalLoggingEnabled()) {
    hub.captureLog('error', `Incident notification job failed: ${err.message}`, {
      error: { name: err.name, message: err.message, stack: err.stack },
      jobId: job?.id,
      incidentId: job?.data?.incidentId,
    });
  }
});

exceptionWorker.on('completed', (job) => {
  if (isInternalLoggingEnabled()) {
    hub.captureLog('info', `Exception parsing job completed`, {
      jobId: job.id,
      logCount: job.data?.logs?.length,
    });
  }
});

exceptionWorker.on('failed', (job, err) => {
  console.error(`Exception parsing job ${job?.id} failed:`, err);

  if (isInternalLoggingEnabled()) {
    hub.captureLog('error', `Exception parsing job failed: ${err.message}`, {
      error: { name: err.name, message: err.message, stack: err.stack },
      jobId: job?.id,
      logCount: job?.data?.logs?.length,
    });
  }
});

errorNotificationWorker.on('completed', (job) => {
  if (isInternalLoggingEnabled()) {
    hub.captureLog('info', `Error notification job completed`, {
      jobId: job.id,
      exceptionId: job.data?.exceptionId,
      exceptionType: job.data?.exceptionType,
    });
  }
});

errorNotificationWorker.on('failed', (job, err) => {
  console.error(`Error notification job ${job?.id} failed:`, err);

  if (isInternalLoggingEnabled()) {
    hub.captureLog('error', `Error notification job failed: ${err.message}`, {
      error: { name: err.name, message: err.message, stack: err.stack },
      jobId: job?.id,
      exceptionId: job?.data?.exceptionId,
    });
  }
});

monitorNotificationWorker.on('completed', (job) => {
  if (isInternalLoggingEnabled()) {
    hub.captureLog('info', `Monitor notification job completed`, {
      jobId: job.id,
      monitorId: job.data?.monitorId,
      status: job.data?.status,
    });
  }
});

monitorNotificationWorker.on('failed', (job, err) => {
  console.error(`Monitor notification job ${job?.id} failed:`, err);

  if (isInternalLoggingEnabled()) {
    hub.captureLog('error', `Monitor notification job failed: ${err.message}`, {
      error: { name: err.name, message: err.message, stack: err.stack },
      jobId: job?.id,
      monitorId: job?.data?.monitorId,
    });
  }
});

pipelineWorker.on('completed', (job) => {
  if (isInternalLoggingEnabled()) {
    hub.captureLog('info', `Log pipeline job completed`, {
      jobId: job.id,
      logCount: job.data?.logs?.length,
    });
  }
});

pipelineWorker.on('failed', (job, err) => {
  console.error(`Log pipeline job ${job?.id} failed:`, err);

  if (isInternalLoggingEnabled()) {
    hub.captureLog('error', `Log pipeline job failed: ${err.message}`, {
      error: { name: err.name, message: err.message, stack: err.stack },
      jobId: job?.id,
      logCount: job?.data?.logs?.length,
    });
  }
});

digestWorker.on('completed', (job) => {
  if (isInternalLoggingEnabled()) {
    hub.captureLog('info', `Digest generation job completed`, {
      jobId: job.id,
      organizationId: job.data?.organizationId,
      frequency: job.data?.frequency,
    });
  }
});

digestWorker.on('failed', (job, err) => {
  if (isInternalLoggingEnabled()) {
    hub.captureLog('error', `Digest generation job failed: ${err.message}`, {
      error: { name: err.name, message: err.message, stack: err.stack },
      jobId: job?.id,
      organizationId: job?.data?.organizationId,
      frequency: job?.data?.frequency,
    });
  }
});

webhookDeliveryWorker.on('failed', (job, err) => {
  console.error(`Webhook delivery job ${job?.id} failed:`, err);
  if (isInternalLoggingEnabled()) {
    hub.captureLog('error', `Webhook delivery job failed: ${err.message}`, {
      error: { name: err.name, message: err.message, stack: err.stack },
      jobId: job?.id,
      deliveryId: job?.data?.deliveryId,
    });
  }
});

// Lock to prevent overlapping alert checks (race condition protection)
let isCheckingAlerts = false;

// Schedule alert checking every minute
async function checkAlerts() {
  await context.runAsSystem('cron:check-alerts', async () => {
    // CRITICAL: Skip if already checking (prevent race condition)
    if (isCheckingAlerts) {
      console.warn('Alert check already in progress, skipping...');
      return;
    }

    isCheckingAlerts = true;
    const checkStartTime = Date.now();

    try {

      const triggeredAlerts = await alertsService.checkAlertRules();
      const checkDuration = Date.now() - checkStartTime;

      if (triggeredAlerts.length > 0) {

        if (isInternalLoggingEnabled()) {
          hub.captureLog('warn', `${triggeredAlerts.length} alert(s) triggered`, {
            alertCount: triggeredAlerts.length,
            alertRuleIds: triggeredAlerts.map((a) => a.rule_id),
            checkDuration_ms: checkDuration,
          });
        }

        // Add notification jobs to queue
        const { createQueue } = await import('./queue/connection.js');
        const notificationQueue = createQueue('alert-notifications');

        for (const alert of triggeredAlerts) {
          // Dedup by the alert_history id so an overlapping evaluation that
          // re-enqueues the same trigger does not send duplicate notifications.
          await notificationQueue.add('send-notification', alert, {
            jobKey: `alert-notif-${alert.historyId}`,
          });

          if (isInternalLoggingEnabled()) {
            hub.captureLog('info', `Alert notification queued`, {
              alertRuleId: alert.rule_id,
              ruleName: alert.rule_name,
              logCount: alert.log_count,
            });
          }
        }
      } else {
        if (isInternalLoggingEnabled()) {
          hub.captureLog('debug', `Alert check completed, no alerts triggered`, {
            checkDuration_ms: checkDuration,
          });
        }
      }
    } catch (error) {
      console.error('Error checking alerts:', error);

      if (isInternalLoggingEnabled()) {
        hub.captureLog('error', `Failed to check alert rules: ${(error as Error).message}`, {
          error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) },
        });
      }
    } finally {
      // CRITICAL: Always release lock
      isCheckingAlerts = false;
    }
  });
}

// Run alert check every minute
setInterval(checkAlerts, 60000);

// Run immediately on start
checkAlerts();

// Lock to prevent overlapping auto-grouping (race condition protection)
let isAutoGrouping = false;

// Schedule incident auto-grouping every 5 minutes
async function runAutoGrouping() {
  await context.runAsSystem('cron:auto-grouping', async () => {
    // Skip if already running
    if (isAutoGrouping) {
      console.warn('Auto-grouping already in progress, skipping...');
      return;
    }

    isAutoGrouping = true;

    try {
      const { createQueue } = await import('./queue/connection.js');
      const autoGroupQueue = createQueue('incident-autogrouping');

      await autoGroupQueue.add('group-incidents', {});

      if (isInternalLoggingEnabled()) {
        hub.captureLog('info', `Incident auto-grouping job scheduled`);
      }
    } catch (error) {
      console.error('Error scheduling auto-grouping:', error);

      if (isInternalLoggingEnabled()) {
        hub.captureLog('error', `Failed to schedule auto-grouping: ${(error as Error).message}`, {
          error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) },
        });
      }
    } finally {
      isAutoGrouping = false;
    }
  });
}

// Run auto-grouping every 5 minutes
setInterval(runAutoGrouping, 5 * 60 * 1000);

// Run immediately on start (after 10 seconds delay to let system stabilize)
setTimeout(runAutoGrouping, 10000);

// ============================================================================
// Enrichment Databases Daily Update (GeoLite2 + IPsum)
// ============================================================================

async function updateEnrichmentDatabases() {
  await context.runAsSystem('cron:enrichment-update', async () => {
    try {
      const results = await enrichmentService.updateDatabasesIfNeeded();

      if (results.geoLite2) {
        console.log('[Worker] GeoLite2 database updated');
        if (isInternalLoggingEnabled()) {
          hub.captureLog('info', 'GeoLite2 database updated successfully');
        }
      }

      if (results.ipsum) {
        console.log('[Worker] IPsum database updated');
        if (isInternalLoggingEnabled()) {
          hub.captureLog('info', 'IPsum database updated successfully');
        }
      }
    } catch (error) {
      console.error('Error updating enrichment databases:', error);
      if (isInternalLoggingEnabled()) {
        hub.captureLog('error', `Failed to update databases: ${(error as Error).message}`, {
          error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) },
        });
      }
    }
  });
}

// Run database updates every 24 hours
setInterval(updateEnrichmentDatabases, 24 * 60 * 60 * 1000);

// Check for updates on start (after 30 seconds delay)
setTimeout(updateEnrichmentDatabases, 30000);

// ============================================================================
// Log Retention Cleanup (Daily at 2 AM)
// ============================================================================

let isRunningRetentionCleanup = false;

async function runRetentionCleanup() {
  await context.runAsSystem('cron:retention-cleanup', async () => {
    // Skip if already running
    if (isRunningRetentionCleanup) {
      console.warn('Retention cleanup already in progress, skipping...');
      return;
    }

    isRunningRetentionCleanup = true;
    const startTime = Date.now();

    try {
      console.log('[Worker] Starting retention cleanup...');
      const summary = await retentionService.executeRetentionForAllOrganizations();
      const duration = Date.now() - startTime;

      console.log(`[Worker] Retention cleanup completed: ${summary.totalLogsDeleted} logs deleted from ${summary.successfulOrganizations}/${summary.totalOrganizations} orgs in ${duration}ms`);

      if (isInternalLoggingEnabled()) {
        hub.captureLog('info', 'Retention cleanup completed', {
          totalOrganizations: summary.totalOrganizations,
          successfulOrganizations: summary.successfulOrganizations,
          failedOrganizations: summary.failedOrganizations,
          totalLogsDeleted: summary.totalLogsDeleted,
          duration_ms: duration,
        });
      }

      // Log any failures
      for (const result of summary.results.filter(r => r.error)) {
        console.error(`Retention failed for org ${result.organizationName}: ${result.error}`);
        if (isInternalLoggingEnabled()) {
          hub.captureLog('error', `Retention failed for org ${result.organizationName}`, {
            organizationId: result.organizationId,
            organizationName: result.organizationName,
            error: result.error,
          });
        }
      }

      const auditSummary = await retentionService.executeAuditRetentionForAllOrganizations();
      console.log(`[Worker] Audit retention: ${auditSummary.totalEntriesDeleted} entries deleted across ${auditSummary.totalOrganizations} orgs`);
      if (auditSummary.totalEntriesDeleted > 0) {
        await auditLogService.record({
          action: 'data.deleted',
          organizationId: null,
          target: { type: 'audit_log', id: null },
          metadata: { scope: 'audit_retention', entriesDeleted: auditSummary.totalEntriesDeleted },
        });
      }
      if (isInternalLoggingEnabled()) {
        hub.captureLog('info', 'Audit retention cleanup completed', {
          totalOrganizations: auditSummary.totalOrganizations,
          totalEntriesDeleted: auditSummary.totalEntriesDeleted,
        });
      }
    } catch (error) {
      console.error('Retention cleanup failed:', error);

      if (isInternalLoggingEnabled()) {
        hub.captureLog('error', `Retention cleanup failed: ${(error as Error).message}`, {
          error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) },
        });
      }
    } finally {
      isRunningRetentionCleanup = false;
    }
  });
}

// Calculate milliseconds until next 2 AM
function getMillisecondsUntil2AM(): number {
  const now = new Date();
  const next2AM = new Date(now);
  next2AM.setHours(2, 0, 0, 0);

  // If it's already past 2 AM today, schedule for tomorrow
  if (now.getTime() > next2AM.getTime()) {
    next2AM.setDate(next2AM.getDate() + 1);
  }

  return next2AM.getTime() - now.getTime();
}

// Schedule daily run at 2 AM
function scheduleNextRetentionCleanup() {
  const msUntilNext = getMillisecondsUntil2AM();
  const nextRunTime = new Date(Date.now() + msUntilNext);

  console.log(`[Worker] Next retention cleanup scheduled for ${nextRunTime.toLocaleString()}`);

  setTimeout(() => {
    runRetentionCleanup();
    // Schedule next run (24 hours later)
    scheduleNextRetentionCleanup();
  }, msUntilNext);
}

// Start scheduling
scheduleNextRetentionCleanup();

// Also run on startup (after 2 minutes delay to let system stabilize)
setTimeout(runRetentionCleanup, 2 * 60 * 1000);

// ============================================================================
// SigmaHQ Daily Sync (Daily at 2:30 AM - 30 min after retention cleanup)
// ============================================================================

let isSyncingSigmaRules = false;

async function syncSigmaRules() {
  await context.runAsSystem('cron:sigma-sync', async () => {
    if (isSyncingSigmaRules) {
      console.warn('[Worker] SigmaHQ sync already in progress, skipping...');
      return;
    }

    isSyncingSigmaRules = true;

    try {
      const orgs = await db
        .selectFrom('sigma_rules')
        .select('organization_id')
        .distinct()
        .where('sigmahq_path', 'is not', null)
        .execute();

      if (orgs.length === 0) {
        console.log('[Worker] No organizations with SigmaHQ rules, skipping sync');
        return;
      }

      console.log(`[Worker] Starting SigmaHQ sync for ${orgs.length} organization(s)`);

      for (const org of orgs) {
        try {
          // Only re-sync the rules this org already imported, to refresh their
          // detection content/commit from upstream. Do NOT fetch the whole
          // SigmaHQ catalog (that path imports and enables thousands of new
          // rules), and do NOT auto-create alert rules: Sigma rules are
          // independent from alert rules.
          const existingRules = await db
            .selectFrom('sigma_rules')
            .select('sigmahq_path')
            .where('organization_id', '=', org.organization_id)
            .where('sigmahq_path', 'is not', null)
            .execute();
          const rulePaths = existingRules
            .map((r) => r.sigmahq_path)
            .filter((p): p is string => Boolean(p));

          if (rulePaths.length === 0) {
            continue;
          }

          const result = await sigmaSyncService.syncFromSigmaHQ({
            organizationId: org.organization_id,
            selection: { rules: rulePaths },
            autoCreateAlerts: false,
            onLimitExceeded: 'skip-new',
          });

          console.log(`[Worker] SigmaHQ sync for org ${org.organization_id}: ${result.imported} imported, ${result.skipped} skipped, ${result.failed} failed`);

          if (isInternalLoggingEnabled()) {
            hub.captureLog('info', `SigmaHQ sync completed for org ${org.organization_id}`, {
              organizationId: org.organization_id,
              imported: result.imported,
              skipped: result.skipped,
              failed: result.failed,
            });
          }
        } catch (orgError) {
          console.error(`[Worker] SigmaHQ sync failed for org ${org.organization_id}:`, orgError);

          if (isInternalLoggingEnabled()) {
            hub.captureLog('error', `SigmaHQ sync failed for org ${org.organization_id}: ${(orgError as Error).message}`, {
              organizationId: org.organization_id,
              error: orgError instanceof Error ? { name: orgError.name, message: orgError.message, stack: orgError.stack } : { message: String(orgError) },
            });
          }
        }
      }
    } catch (error) {
      console.error('[Worker] SigmaHQ sync aborted:', error);

      if (isInternalLoggingEnabled()) {
        hub.captureLog('error', `SigmaHQ sync aborted: ${(error as Error).message}`, {
          error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) },
        });
      }
    } finally {
      isSyncingSigmaRules = false;
    }
  });
}

function scheduleNextSigmaSync() {
  const msUntilNext2AM = getMillisecondsUntil2AM();
  const offsetMs = 30 * 60 * 1000; // +30 minutes → 2:30 AM
  const nextRun = new Date(Date.now() + msUntilNext2AM + offsetMs);

  console.log(`[Worker] Next SigmaHQ sync scheduled for ${nextRun.toLocaleString()}`);

  setTimeout(() => {
    syncSigmaRules();
    scheduleNextSigmaSync();
  }, msUntilNext2AM + offsetMs);
}

scheduleNextSigmaSync();

// ============================================================================
// Service Health Monitor Checks (every 30 seconds)
// ============================================================================

let isRunningMonitorChecks = false;

async function runMonitorChecks() {
  await context.runAsSystem('cron:monitor-checks', async () => {
    if (isRunningMonitorChecks) return;
    isRunningMonitorChecks = true;
    try {
      await monitorService.runAllDueChecks();
    } catch (error) {
      console.error('[Worker] Monitor check error:', error);
      if (isInternalLoggingEnabled()) {
        hub.captureLog('error', `Monitor check failed: ${(error as Error).message}`, {
          error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) },
        });
      }
    } finally {
      isRunningMonitorChecks = false;
    }
  });
}

// Run checks every 30 seconds
setInterval(runMonitorChecks, 30000);
// Run immediately on start
runMonitorChecks();

// ============================================================================
// Scheduled Maintenance Transitions (every 60 seconds)
// ============================================================================

let isRunningMaintenanceCheck = false;

async function runMaintenanceTransitions() {
  await context.runAsSystem('cron:maintenance-transitions', async () => {
    if (isRunningMaintenanceCheck) return;
    isRunningMaintenanceCheck = true;
    try {
      await maintenanceService.processMaintenanceTransitions();
    } catch (error) {
      console.error('[Worker] Maintenance transition error:', error);
    } finally {
      isRunningMaintenanceCheck = false;
    }
  });
}

setInterval(runMaintenanceTransitions, 60000);
runMaintenanceTransitions();

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}, shutting down gracefully...`);

  try {
    // Stop accepting new jobs
    await alertWorker.close();
    await sigmaWorker.close();
    await autoGroupWorker.close();
    await invitationWorker.close();
    await incidentNotificationWorker.close();
    await exceptionWorker.close();
    await errorNotificationWorker.close();
    await monitorNotificationWorker.close();
    await pipelineWorker.close();
    await digestWorker.close();
    await webhookDeliveryWorker.close();
    console.log('[Worker] Workers closed');

    // Close queue system (Redis/PostgreSQL connections)
    await shutdownQueueSystem();
    console.log('[Worker] Queue system closed');

    // Close internal logging
    await shutdownInternalLogging();
    console.log('[Worker] Internal logging closed');

    // Close database pool - CRITICAL: prevents connection leaks
    const { closeDatabase } = await import('./database/connection.js');
    await closeDatabase();
    console.log('[Worker] Database pool closed');

    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
