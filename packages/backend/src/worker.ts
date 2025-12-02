import { createWorker } from './queue/connection.js';
import { processAlertNotification } from './queue/jobs/alert-notification.js';
import { processSigmaDetection } from './queue/jobs/sigma-detection.js';
import { alertsService } from './modules/alerts/index.js';
import { initializeInternalLogging, shutdownInternalLogging, getInternalLogger } from './utils/internal-logger.js';

// Initialize internal logging
await initializeInternalLogging();

// Create worker for alert notifications
const alertWorker = createWorker('alert-notifications', async (job) => {
  await processAlertNotification(job);
});

// Create worker for Sigma detection
const sigmaWorker = createWorker('sigma-detection', async (job) => {
  await processSigmaDetection(job);
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

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);

  try {
    // Stop accepting new jobs
    await alertWorker.close();
    await sigmaWorker.close();
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
