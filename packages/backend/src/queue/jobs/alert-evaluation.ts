import type { IQueueAdapter } from '../abstractions/types.js';
import type { AlertEvaluationResult, AlertNotificationJobData } from '../../modules/alerts/types.js';

/**
 * Queue job key of one alert notification.
 *
 * One key per notification, never reused, colon-free so it is a valid BullMQ
 * custom job id and behaves the same under graphile-worker (which replaces a
 * pending job with the same key):
 * - `triggered` / `renotify`: `alert-notif-<alert_history id>`
 * - `resolved`: `alert-resolved-<rule id>-<firing since, epoch ms>` (one per
 *   firing episode)
 */
export function alertNotificationJobKey(result: AlertEvaluationResult): string {
  if (result.kind === 'resolved') {
    return `alert-resolved-${result.rule_id}-${Date.parse(result.firing_since)}`;
  }
  return `alert-notif-${result.historyId}`;
}

/**
 * Enqueue the notifications produced by one evaluation run on the
 * `alert-notifications` queue. Only the job key is passed, so the queue
 * cleanup defaults stay in force. The worker dispatches on `job.data.kind`;
 * the job name is informational (graphile reports the queue name instead).
 *
 * A failing `add` is logged and skipped so it never drops the remaining
 * notifications of the run. Returns the number of jobs enqueued.
 */
export async function enqueueAlertNotifications(
  results: AlertEvaluationResult[],
  queue: Pick<IQueueAdapter<AlertNotificationJobData>, 'add'>
): Promise<number> {
  let enqueued = 0;
  for (const result of results) {
    const jobName = result.kind === 'resolved' ? 'send-resolved' : 'send-notification';
    try {
      await queue.add(jobName, result, { jobKey: alertNotificationJobKey(result) });
      enqueued++;
    } catch (error) {
      console.error(`[Alerts] Failed to enqueue ${result.kind} notification for rule ${result.rule_id}:`, error);
    }
  }
  return enqueued;
}
