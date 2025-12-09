import { createWorker } from './queue/connection.js';
import { processAlertNotification } from './queue/jobs/alert-notification.js';
import { processSigmaDetection } from './queue/jobs/sigma-detection.js';
import { processIncidentAutoGrouping } from './queue/jobs/incident-autogrouping.js';
import { processInvitationEmail } from './queue/jobs/invitation-email.js';
import { processIncidentNotification } from './queue/jobs/incident-notification.js';
import { alertsService } from './modules/alerts/index.js';
import { enrichmentService } from './modules/siem/enrichment-service.js';
import { initializeInternalLogging, shutdownInternalLogging, getInternalLogger } from './utils/internal-logger.js';

// Initialize internal logging
await initializeInternalLogging();

// Initialize enrichment services (downloads GeoLite2 if missing)
await enrichmentService.initialize();

// Create worker for alert notifications
const alertWorker = createWorker('alert-notifications', async (job) => {
  await processAlertNotification(job);
});

// Create worker for Sigma detection
const sigmaWorker = createWorker('sigma-detection', async (job) => {
  await processSigmaDetection(job);
});

// Create worker for incident auto-grouping
const autoGroupWorker = createWorker('incident-autogrouping', async (job) => {
  await processIncidentAutoGrouping(job);
});

// Create worker for invitation emails
const invitationWorker = createWorker('invitation-email', async (job) => {
  await processInvitationEmail(job);
});

// Create worker for incident notifications
const incidentNotificationWorker = createWorker('incident-notifications', async (job) => {
  await processIncidentNotification(job);
});

alertWorker.on('completed', (job) => {

  const logger = getInternalLogger();
  if (logger) {
    logger.info('worker-job-completed', `Alert notification job completed`, {
      jobId: job.id,
      alertRuleId: job.data?.alertRuleId,
      logCount: job.data?.logCount,
    });
  }
});

alertWorker.on('failed', (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err);

  const logger = getInternalLogger();
  if (logger) {
    logger.error('worker-job-failed', `Alert notification job failed: ${err.message}`, {
      error: err,
      jobId: job?.id,
      alertRuleId: job?.data?.alertRuleId,
    });
  }
});

sigmaWorker.on('completed', (job) => {

  const logger = getInternalLogger();
  if (logger) {
    logger.info('worker-sigma-completed', `Sigma detection job completed`, {
      jobId: job.id,
      logCount: job.data?.logs?.length,
    });
  }
});

sigmaWorker.on('failed', (job, err) => {
  console.error(`❌ Sigma detection job ${job?.id} failed:`, err);

  const logger = getInternalLogger();
  if (logger) {
    logger.error('worker-sigma-failed', `Sigma detection job failed: ${err.message}`, {
      error: err,
      jobId: job?.id,
      logCount: job?.data?.logs?.length,
    });
  }
});

autoGroupWorker.on('completed', (job) => {
  const logger = getInternalLogger();
  if (logger) {
    logger.info('worker-autogrouping-completed', `Incident auto-grouping job completed`, {
      jobId: job.id,
    });
  }
});

autoGroupWorker.on('failed', (job, err) => {
  console.error(`❌ Incident auto-grouping job ${job?.id} failed:`, err);

  const logger = getInternalLogger();
  if (logger) {
    logger.error('worker-autogrouping-failed', `Incident auto-grouping job failed: ${err.message}`, {
      error: err,
      jobId: job?.id,
    });
  }
});

invitationWorker.on('completed', (job) => {
  const logger = getInternalLogger();
  if (logger) {
    logger.info('worker-invitation-completed', `Invitation email job completed`, {
      jobId: job.id,
      email: job.data?.email,
    });
  }
});

invitationWorker.on('failed', (job, err) => {
  console.error(`❌ Invitation email job ${job?.id} failed:`, err);

  const logger = getInternalLogger();
  if (logger) {
    logger.error('worker-invitation-failed', `Invitation email job failed: ${err.message}`, {
      error: err,
      jobId: job?.id,
      email: job?.data?.email,
    });
  }
});

incidentNotificationWorker.on('completed', (job) => {
  const logger = getInternalLogger();
  if (logger) {
    logger.info('worker-incident-notification-completed', `Incident notification job completed`, {
      jobId: job.id,
      incidentId: job.data?.incidentId,
    });
  }
});

incidentNotificationWorker.on('failed', (job, err) => {
  console.error(`❌ Incident notification job ${job?.id} failed:`, err);

  const logger = getInternalLogger();
  if (logger) {
    logger.error('worker-incident-notification-failed', `Incident notification job failed: ${err.message}`, {
      error: err,
      jobId: job?.id,
      incidentId: job?.data?.incidentId,
    });
  }
});

// Lock to prevent overlapping alert checks (race condition protection)
let isCheckingAlerts = false;

// Schedule alert checking every minute
async function checkAlerts() {
  // CRITICAL: Skip if already checking (prevent race condition)
  if (isCheckingAlerts) {
    console.warn('⚠️  Alert check already in progress, skipping...');
    return;
  }

  isCheckingAlerts = true;
  const logger = getInternalLogger();
  const checkStartTime = Date.now();

  try {

    const triggeredAlerts = await alertsService.checkAlertRules();
    const checkDuration = Date.now() - checkStartTime;

    if (triggeredAlerts.length > 0) {

      // Log triggered alerts
      if (logger) {
        logger.warn('worker-alerts-triggered', `${triggeredAlerts.length} alert(s) triggered`, {
          alertCount: triggeredAlerts.length,
          alertRuleIds: triggeredAlerts.map((a) => a.rule_id),
          checkDuration_ms: checkDuration,
        });
      }

      // Add notification jobs to queue
      const { createQueue } = await import('./queue/connection.js');
      const notificationQueue = createQueue('alert-notifications');

      for (const alert of triggeredAlerts) {
        await notificationQueue.add('send-notification', alert);

        // Log each alert queued
        if (logger) {
          logger.info('worker-alert-queued', `Alert notification queued`, {
            alertRuleId: alert.rule_id,
            ruleName: alert.rule_name,
            logCount: alert.log_count,
          });
        }
      }
    } else {
      // Log no alerts triggered
      if (logger) {
        logger.debug('worker-alert-check-complete', `Alert check completed, no alerts triggered`, {
          checkDuration_ms: checkDuration,
        });
      }
    }
  } catch (error) {
    console.error('Error checking alerts:', error);

    // Log error
    if (logger) {
      logger.error('worker-alert-check-error', `Failed to check alert rules: ${(error as Error).message}`, {
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  } finally {
    // CRITICAL: Always release lock
    isCheckingAlerts = false;
  }
}

// Run alert check every minute
setInterval(checkAlerts, 60000);

// Run immediately on start
checkAlerts();

// Lock to prevent overlapping auto-grouping (race condition protection)
let isAutoGrouping = false;

// Schedule incident auto-grouping every 5 minutes
async function runAutoGrouping() {
  // Skip if already running
  if (isAutoGrouping) {
    console.warn('⚠️  Auto-grouping already in progress, skipping...');
    return;
  }

  isAutoGrouping = true;
  const logger = getInternalLogger();

  try {
    const { createQueue } = await import('./queue/connection.js');
    const autoGroupQueue = createQueue('incident-autogrouping');

    await autoGroupQueue.add('group-incidents', {});

    if (logger) {
      logger.info('worker-autogrouping-scheduled', `Incident auto-grouping job scheduled`);
    }
  } catch (error) {
    console.error('Error scheduling auto-grouping:', error);

    if (logger) {
      logger.error('worker-autogrouping-schedule-error', `Failed to schedule auto-grouping: ${(error as Error).message}`, {
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  } finally {
    isAutoGrouping = false;
  }
}

// Run auto-grouping every 5 minutes
setInterval(runAutoGrouping, 5 * 60 * 1000);

// Run immediately on start (after 10 seconds delay to let system stabilize)
setTimeout(runAutoGrouping, 10000);

// ============================================================================
// Enrichment Databases Daily Update (GeoLite2 + IPsum)
// ============================================================================

async function updateEnrichmentDatabases() {
  const logger = getInternalLogger();

  try {
    const results = await enrichmentService.updateDatabasesIfNeeded();

    if (results.geoLite2) {
      console.log('✅ GeoLite2 database updated');
      if (logger) {
        logger.info('worker-geolite2-updated', 'GeoLite2 database updated successfully');
      }
    }

    if (results.ipsum) {
      console.log('✅ IPsum database updated');
      if (logger) {
        logger.info('worker-ipsum-updated', 'IPsum database updated successfully');
      }
    }
  } catch (error) {
    console.error('Error updating enrichment databases:', error);
    if (logger) {
      logger.error('worker-enrichment-update-error', `Failed to update databases: ${(error as Error).message}`, {
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
}

// Run database updates every 24 hours
setInterval(updateEnrichmentDatabases, 24 * 60 * 60 * 1000);

// Check for updates on start (after 30 seconds delay)
setTimeout(updateEnrichmentDatabases, 30000);

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);

  try {
    // Stop accepting new jobs
    await alertWorker.close();
    await sigmaWorker.close();
    await autoGroupWorker.close();
    await invitationWorker.close();
    await incidentNotificationWorker.close();
    console.log('✅ Workers closed');

    // Close internal logging
    await shutdownInternalLogging();
    console.log('✅ Internal logging closed');

    // Close database pool - CRITICAL: prevents connection leaks
    const { closeDatabase } = await import('./database/connection.js');
    await closeDatabase();
    console.log('✅ Database pool closed');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
