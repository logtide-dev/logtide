import type { LogLevel, MetadataFilter } from '@logtide/shared';
import type { AlertType, BaselineMetadata } from '../../database/types.js';

/** Notification kinds that carry an alert_history row. */
export type AlertNotificationKind = 'triggered' | 'renotify';

/**
 * Job data of a firing notification on the `alert-notifications` queue.
 * `kind` is absent on Sigma detection jobs and on jobs left by a pre-1.6
 * worker: those keep the pre-1.6 behaviour (triggered copy, rule channels
 * only, markAsNotified only when historyId is set).
 */
export interface AlertNotificationData {
  historyId: string;
  rule_id: string;
  rule_name: string;
  organization_id: string;
  project_id: string | null;
  log_count: number;
  threshold: number;
  time_window: number;
  // Legacy fields (deprecated, use notification_channels instead)
  email_recipients: string[];
  webhook_url?: string | null;
  // Rate-of-change metadata (present only for rate_of_change alerts)
  baseline_metadata?: {
    baseline_value: number;
    current_value: number;
    deviation_ratio: number;
    baseline_type: string;
    evaluation_time: string;
  };
  // 1.6 lifecycle fields (absent on Sigma and pre-1.6 jobs)
  kind?: AlertNotificationKind;
  /** ISO start of the firing episode (the rule's last_triggered_at). */
  firing_since?: string;
  incident_id?: string | null;
}

/** Job data of a resolution: sends only the `alert.resolved` webhook event. */
export interface AlertResolvedNotificationData {
  kind: 'resolved';
  rule_id: string;
  rule_name: string;
  organization_id: string;
  project_id: string | null;
  alert_type: AlertType;
  log_count: number;
  threshold: number;
  time_window: number;
  firing_since: string;
  resolved_at: string;
  incident_id: string | null;
}

export type AlertNotificationJobData = AlertNotificationData | AlertResolvedNotificationData;

/** A notification produced by one evaluation run, ready to enqueue. */
export type AlertTriggeredResult = AlertNotificationData & {
  kind: AlertNotificationKind;
  firing_since: string;
  incident_id: string | null;
};

export type AlertEvaluationResult = AlertTriggeredResult | AlertResolvedNotificationData;

/**
 * Metadata stored on the alert incident (F4 source event) so the incident
 * source panel can show the rule summary and build "Show matched logs".
 */
export interface AlertIncidentMetadata {
  ruleId: string;
  alertType: AlertType;
  notification: AlertNotificationKind | null;
  historyId: string | null;
  logCount: number;
  threshold: number;
  /** minutes */
  timeWindow: number;
  level: LogLevel[];
  service: string | null;
  query: string | null;
  metadataFilters: MetadataFilter[];
  /** ISO, now - time_window */
  windowFrom: string;
  /** ISO, the evaluation time */
  windowTo: string;
  baselineMetadata: BaselineMetadata | null;
}
