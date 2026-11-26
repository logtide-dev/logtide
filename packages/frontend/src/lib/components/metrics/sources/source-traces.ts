// Pure rules of the Traces tab of a source page: which traces it lists, the
// links it builds and the two activity charts. No I/O, so every branch is unit
// tested.

import type { EChartsOption } from 'echarts';
import { quoteFieldValue, type MetricSourceKind, type SourceTraceBucket } from '@logtide/shared';
import { getAxisStyle, getTooltipStyle } from '$lib/utils/echarts-theme';
import { writeTraceFilters } from '$lib/utils/trace-filters';
import { formatDuration } from '$lib/components/traces/format';

/**
 * Attribute filter of the trace list: traces with a span from this host (its
 * resource host.name) or this service, optionally only spans of one service
 * running on the host.
 */
export function sourceTraceAttr(kind: MetricSourceKind, name: string, service: string | null = null): string {
  const own = `resource.${kind === 'host' ? 'host.name' : 'service.name'}:${quoteFieldValue(name)}`;
  return kind === 'host' && service ? `${own} resource.service.name:${quoteFieldValue(service)}` : own;
}

/** The Traces explorer with the same filter (it reads one project, the first of the source). */
export function sourceTracesHref(input: {
  attr: string;
  errorsOnly: boolean;
  projectId: string | null;
  from: string;
  to: string;
}): string {
  const url = writeTraceFilters(new URL('/dashboard/traces', 'http://local.invalid'), {
    attr: input.attr,
    ...(input.errorsOnly ? { status: 'errors' as const } : {}),
  });
  if (input.projectId) url.searchParams.set('project', input.projectId);
  url.searchParams.set('from', input.from);
  url.searchParams.set('to', input.to);
  return `${url.pathname}${url.search}`;
}

export function errorRate(totals: { requests: number; errors: number }): number | null {
  return totals.requests > 0 ? (totals.errors / totals.requests) * 100 : null;
}

export interface TraceChartColors {
  ok: string;
  error: string;
  latency: string;
}

function baseOption(formatAxis: (ms: number) => string, bucketMs: number, starts: number[]): EChartsOption {
  const axis = getAxisStyle();
  return {
    animation: false,
    grid: { left: 8, right: 12, top: 12, bottom: 4, containLabel: true },
    xAxis: {
      type: 'time',
      min: starts.length > 0 ? starts[0] : undefined,
      max: starts.length > 0 ? starts[starts.length - 1] + bucketMs : undefined,
      ...axis,
      axisLabel: { ...axis.axisLabel, hideOverlap: true, formatter: (v: number) => formatAxis(v) },
      splitLine: { show: false },
    },
  };
}

/** Stacked bars: requests that succeeded and requests that failed, per bucket. */
export function buildRequestsOption(i: {
  buckets: SourceTraceBucket[];
  bucketSeconds: number;
  colors: TraceChartColors;
  formatAxis: (ms: number) => string;
}): EChartsOption {
  const bucketMs = i.bucketSeconds * 1000;
  const starts = i.buckets.map((b) => Date.parse(b.time));
  const axis = getAxisStyle();
  const at = (index: number) => starts[index] + bucketMs / 2;
  return {
    ...baseOption(i.formatAxis, bucketMs, starts),
    tooltip: {
      trigger: 'axis',
      ...getTooltipStyle(),
      valueFormatter: (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : String(v ?? '')),
    },
    yAxis: { type: 'value', minInterval: 1, ...axis },
    series: [
      {
        name: 'OK',
        type: 'bar',
        stack: 'requests',
        data: i.buckets.map((b, index) => [at(index), Math.max(0, b.requests - b.errors)]),
        itemStyle: { color: i.colors.ok },
        barCategoryGap: '10%',
        barMaxWidth: 24,
      },
      {
        name: 'Errors',
        type: 'bar',
        stack: 'requests',
        data: i.buckets.map((b, index) => [at(index), b.errors]),
        itemStyle: { color: i.colors.error },
        barMaxWidth: 24,
      },
    ],
  };
}

/** p95 latency per bucket; buckets without requests leave a gap. */
export function buildLatencyOption(i: {
  buckets: SourceTraceBucket[];
  bucketSeconds: number;
  colors: TraceChartColors;
  formatAxis: (ms: number) => string;
}): EChartsOption {
  const bucketMs = i.bucketSeconds * 1000;
  const starts = i.buckets.map((b) => Date.parse(b.time));
  const axis = getAxisStyle();
  return {
    ...baseOption(i.formatAxis, bucketMs, starts),
    tooltip: {
      trigger: 'axis',
      ...getTooltipStyle(),
      valueFormatter: (v) => (typeof v === 'number' ? formatDuration(v) : '-'),
    },
    yAxis: {
      type: 'value',
      ...axis,
      axisLabel: { ...axis.axisLabel, formatter: (v: number) => formatDuration(v) },
    },
    series: [
      {
        name: 'p95',
        type: 'line',
        showSymbol: false,
        connectNulls: false,
        data: i.buckets.map((b, index) => [starts[index] + bucketMs / 2, b.p95]),
        lineStyle: { color: i.colors.latency, width: 2 },
        itemStyle: { color: i.colors.latency },
        areaStyle: { color: i.colors.latency, opacity: 0.08 },
      },
    ],
  };
}
