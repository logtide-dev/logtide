import { MeteringRecorder } from './recorder.js';
import type { MeteringEvent } from './types.js';

/** Process-wide singleton recorder. Started in server.ts, stopped on shutdown. */
export const meteringRecorder = new MeteringRecorder();

/** Thin facade so callsites depend on `metering.record(...)`, not the recorder class. */
export const metering = {
  record(event: MeteringEvent): void {
    meteringRecorder.record(event);
  },
};

/**
 * Recording site helper for log ingestion. Fire-and-forget.
 * `logs` is the raw input batch; bytes are measured from its JSON serialization.
 */
export function recordLogIngestion(params: {
  logs: unknown[];
  eventCount: number;
  organizationId: string;
  projectId: string;
}): void {
  const bytes = Buffer.byteLength(JSON.stringify(params.logs));
  metering.record({
    type: 'logs.ingested.bytes',
    quantity: bytes,
    organizationId: params.organizationId,
    projectId: params.projectId,
  });
  metering.record({
    type: 'logs.ingested.events',
    quantity: params.eventCount,
    organizationId: params.organizationId,
    projectId: params.projectId,
  });
}

/**
 * Recording site helper for span ingestion (#212 follow-up). Fire-and-forget.
 * Count only; span bytes are not metered.
 */
export function recordSpanIngestion(params: {
  spanCount: number;
  organizationId: string;
  projectId: string;
}): void {
  if (params.spanCount <= 0) return;
  metering.record({
    type: 'spans.ingested',
    quantity: params.spanCount,
    organizationId: params.organizationId,
    projectId: params.projectId,
  });
}

/**
 * Recording site helper for metric ingestion. Fire-and-forget.
 * Count of accepted datapoints; billed, so not under the ingestion.* prefix.
 */
export function recordMetricIngestion(params: {
  datapointCount: number;
  organizationId: string;
  projectId: string;
}): void {
  if (params.datapointCount <= 0) return;
  metering.record({
    type: 'metrics.ingested.datapoints',
    quantity: params.datapointCount,
    organizationId: params.organizationId,
    projectId: params.projectId,
  });
}

export { MeteringRecorder } from './recorder.js';
export { meteringService, MeteringService } from './service.js';
export { getUsageBreakdown } from './breakdown.js';
export type { UsageBreakdown, UsageBreakdownParams, ProjectUsage, TypeUsage, ValueCount } from './breakdown.js';
export type { MeteringEvent, MeteringEventType } from './types.js';
export type { UsageAggregateParams, UsageGroupBy, UsageRow } from './service.js';
export { usageRoutes } from './routes.js';
