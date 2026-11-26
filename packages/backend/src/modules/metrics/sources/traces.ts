// Trace activity of a source (Traces tab of a host or service page): requests,
// errors and p95 per bucket from its entry spans, one reservoir call on every
// engine. A host is matched by the resource host.name of the spans, a service
// by its service name.

import type { MetricSourceKind, SourceTraceBucket, SourceTraceSeries, SpanKind } from '@logtide/shared';
import { reservoir } from '../../../database/reservoir.js';
import type { SourcesContext } from './service.js';

/** A request is an entry span: one per call the source handled. */
export const ENTRY_SPAN_KINDS: SpanKind[] = ['SERVER', 'CONSUMER'];

/** Bucket widths the reservoir accepts (60 s to one day). */
const STEPS_SECONDS = [60, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400];

/** About this many buckets per chart. */
export const TRACE_SERIES_POINTS = 60;

/** The smallest step that keeps the window within TRACE_SERIES_POINTS buckets (one day at most). */
export function pickTraceBucketSeconds(spanMs: number): number {
  const seconds = Math.max(1, spanMs / 1000);
  return STEPS_SECONDS.find((s) => Math.ceil(seconds / s) <= TRACE_SERIES_POINTS) ?? STEPS_SECONDS[STEPS_SECONDS.length - 1];
}

/** Every bucket from the one holding `from` to the one holding `to`, empty ones at zero. */
export function fillTraceBuckets(
  rows: Array<{ time: Date; spanCount: number; errorCount: number; p95: number | null }>,
  from: Date,
  to: Date,
  bucketSeconds: number,
): SourceTraceBucket[] {
  const step = bucketSeconds * 1000;
  const byStart = new Map(rows.map((r) => [Math.floor(r.time.getTime() / step) * step, r]));
  const out: SourceTraceBucket[] = [];
  for (let t = Math.floor(from.getTime() / step) * step; t <= to.getTime(); t += step) {
    const r = byStart.get(t);
    out.push({
      time: new Date(t).toISOString(),
      requests: r?.spanCount ?? 0,
      errors: r?.errorCount ?? 0,
      p95: r && r.spanCount > 0 && r.p95 !== null && Number.isFinite(r.p95) ? r.p95 : null,
    });
  }
  return out;
}

export async function getSourceTraceSeries(
  ctx: SourcesContext,
  kind: MetricSourceKind,
  name: string,
): Promise<SourceTraceSeries> {
  const bucketSeconds = pickTraceBucketSeconds(ctx.to.getTime() - ctx.from.getTime());
  const rows =
    ctx.projectIds.length === 0
      ? []
      : await reservoir.getSpanTimeseries({
          projectIds: ctx.projectIds,
          from: ctx.from,
          to: ctx.to,
          bucketSeconds,
          kinds: ENTRY_SPAN_KINDS,
          ...(kind === 'host'
            ? { attributeFilters: [{ key: 'resource.host.name', op: 'equals' as const, value: name, include_missing: false }] }
            : { serviceName: name }),
        });
  const buckets = fillTraceBuckets(rows, ctx.from, ctx.to, bucketSeconds);
  const totals = buckets.reduce(
    (acc, b) => ({ requests: acc.requests + b.requests, errors: acc.errors + b.errors }),
    { requests: 0, errors: 0 },
  );
  return { bucketSeconds, buckets, totals };
}
