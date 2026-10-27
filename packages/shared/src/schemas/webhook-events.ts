import { z } from 'zod';

export const webhookEventTypeSchema = z.enum([
  'alert.triggered',
  'alert.resolved',
  'incident.created',
  'error.detected',
  'monitor.status_changed',
  'project.health.opened',
  'project.health.resolved',
  'channel.test',
  // Generic notification deliveries through notification channels.
  // Type-specific events (alert.triggered, etc.) use their own types via the queue jobs.
  'channel.notification',
]);
export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>;

const organizationRefSchema = z.object({ id: z.string().uuid(), name: z.string() });

export const alertTriggeredDataSchema = z
  .object({
    alert_name: z.string(),
    log_count: z.number(),
    threshold: z.number(),
    time_window: z.number(),
    baseline_metadata: z
      .object({
        baseline_value: z.number(),
        current_value: z.number(),
        deviation_ratio: z.number(),
        baseline_type: z.string(),
        evaluation_time: z.string(),
      })
      .nullable(),
    link: z.string(),
    // 1.6 alert lifecycle fields. Optional so pre-1.6 payloads, Sigma
    // detections and replays of old deliveries stay valid.
    alert_rule_id: z.string().uuid().optional(),
    renotify: z.boolean().optional(),
    firing_since: z.string().datetime().optional(),
    incident_id: z.string().uuid().nullable().optional(),
  })
  .passthrough();

/**
 * A firing alert rule returned to OK. Sent only when the firing notification
 * was sent; snoozing does not suppress it. time_window is in minutes.
 */
export const alertResolvedDataSchema = z
  .object({
    alert_rule_id: z.string().uuid(),
    alert_name: z.string(),
    alert_type: z.enum(['threshold', 'rate_of_change']),
    title: z.string(),
    message: z.string(),
    log_count: z.number(),
    threshold: z.number(),
    time_window: z.number(),
    firing_since: z.string().datetime(),
    resolved_at: z.string().datetime(),
    duration_seconds: z.number().int().min(0),
    incident_id: z.string().uuid().nullable(),
    link: z.string(),
  })
  .passthrough();
export type AlertResolvedData = z.infer<typeof alertResolvedDataSchema>;

export const errorDetectedDataSchema = z
  .object({
    title: z.string(),
    message: z.string(),
    severity: z.string(),
    organization: organizationRefSchema,
    // project is always sent by the producer; id may be null (ErrorNotificationJobData.projectId)
    project: z.object({ id: z.string().uuid().nullable(), name: z.string() }),
    error_group_id: z.string(),
    exception_type: z.string().nullable().optional(),
    language: z.string().nullable().optional(),
    service: z.string().nullable().optional(),
    is_new: z.boolean(),
    link: z.string(),
  })
  .passthrough();

export const monitorStatusChangedDataSchema = z
  .object({
    monitor_id: z.string(),
    monitor_name: z.string(),
    status: z.string(),
    severity: z.string(),
    title: z.string(),
    message: z.string(),
    organization: organizationRefSchema,
    target: z.string().nullable().optional(),
    error_code: z.string().nullable().optional(),
    response_time_ms: z.number().nullable().optional(),
    consecutive_failures: z.number().optional(),
    downtime_duration: z.string().nullable().optional(),
    link: z.string(),
  })
  .passthrough();

export const incidentCreatedDataSchema = z
  .object({
    title: z.string(),
    message: z.string(),
    severity: z.string(),
    organization: organizationRefSchema,
    incident_id: z.string(),
    affected_services: z.array(z.string()).optional(),
    link: z.string(),
  })
  .passthrough();

/** Project health issue opened or resolved. resolved_at is null while open. */
export const projectHealthDataSchema = z
  .object({
    project_id: z.string().uuid(),
    project_name: z.string(),
    check_key: z.string(),
    severity: z.enum(['critical', 'warning']),
    title: z.string(),
    message: z.string(),
    opened_at: z.string().datetime(),
    resolved_at: z.string().datetime().nullable(),
    details: z.record(z.unknown()),
    link: z.string(),
  })
  .passthrough();
export type ProjectHealthData = z.infer<typeof projectHealthDataSchema>;

export const channelNotificationDataSchema = z
  .object({
    title: z.string(),
    message: z.string(),
    severity: z.string().optional(),
    organization: z.object({ id: z.string().uuid(), name: z.string() }).optional(),
    link: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const webhookEnvelopeSchema = z.object({
  id: z.string().regex(/^evt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
  type: webhookEventTypeSchema,
  version: z.literal(1),
  occurredAt: z.string().datetime(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  data: z.record(z.unknown()),
});
export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

export const WEBHOOK_EVENT_DATA_SCHEMAS = {
  'alert.triggered': alertTriggeredDataSchema,
  'alert.resolved': alertResolvedDataSchema,
  'incident.created': incidentCreatedDataSchema,
  'error.detected': errorDetectedDataSchema,
  'monitor.status_changed': monitorStatusChangedDataSchema,
  'project.health.opened': projectHealthDataSchema,
  'project.health.resolved': projectHealthDataSchema,
  'channel.test': channelNotificationDataSchema,
  'channel.notification': channelNotificationDataSchema,
} as const;

/** Parse an envelope AND validate its per-type data schema. */
export function parseWebhookEvent(input: unknown): WebhookEnvelope {
  const envelope = webhookEnvelopeSchema.parse(input);
  WEBHOOK_EVENT_DATA_SCHEMAS[envelope.type].parse(envelope.data);
  return envelope;
}
