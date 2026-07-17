/**
 * Resource usage metering event types (#212).
 * The full set is declared up front so deferred recording sites
 * (spans, metric cardinality, storage snapshots) need no type change.
 * Only `logs.ingested.*` are wired in this plan.
 */
export type MeteringEventType =
  | 'logs.ingested.bytes'
  | 'logs.ingested.events'
  | 'spans.ingested'
  | 'metrics.cardinality'
  | 'storage.snapshot'
  // Ingestion health counters (WS1): not billed, surfaced in admin stats.
  | 'ingestion.pii_rejected'
  | 'ingestion.detection_enqueue_failed'
  | 'ingestion.exception_enqueue_failed'
  | 'ingestion.identifier_failed'
  // Clock skew at ingestion (#279): not billed, surfaced in admin stats and per project.
  | 'ingestion.timestamp_skew'
  // Clock skew for spans/metrics (span-metric-skew): same rationale as above,
  // kept under the ingestion.* prefix (see breakdown.ts / recorder.ts).
  | 'ingestion.span_timestamp_skew'
  | 'ingestion.metric_timestamp_skew';

export interface MeteringEvent {
  type: MeteringEventType;
  quantity: number;
  organizationId: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
  /** Defaults to now() at flush time if omitted. */
  time?: Date;
}
