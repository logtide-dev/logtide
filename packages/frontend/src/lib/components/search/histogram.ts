// Log volume histogram (spec 5.4): bucket size for a range, click and drag
// selection snapped to bucket edges, and the stacked-by-level ECharts option.
// Every time here is an absolute instant (epoch ms or ISO with `Z`); only the
// labels produced by `formatAxis` follow the display time zone.

import type { EChartsOption } from 'echarts';
import { LOG_LEVELS, type LogLevel } from '@logtide/shared';
import type { LogHistogramBucket } from '$lib/api/logs';
import { getAxisStyle, getTooltipStyle } from '$lib/utils/echarts-theme';

export const HISTOGRAM_MAX_BUCKETS = 100;

export const BUCKET_STEPS_SECONDS = [
  1, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400,
] as const;

const DAY_SECONDS = 86400;

const LEVEL_SERIES_NAMES: Record<LogLevel, string> = {
  debug: 'Debug',
  info: 'Info',
  warn: 'Warn',
  error: 'Error',
  critical: 'Critical',
};

/** Smallest step giving at most 100 buckets; whole days beyond one-day buckets. */
export function pickBucketSeconds(rangeMs: number): number {
  const rangeSeconds = Math.max(0, rangeMs) / 1000;
  for (const step of BUCKET_STEPS_SECONDS) {
    if (Math.ceil(rangeSeconds / step) <= HISTOGRAM_MAX_BUCKETS) return step;
  }
  return DAY_SECONDS * Math.ceil(rangeSeconds / DAY_SECONDS / HISTOGRAM_MAX_BUCKETS);
}

export function bucketToWindow(bucketTime: string, bucketSeconds: number): { from: Date; to: Date } {
  const from = Date.parse(bucketTime);
  return { from: new Date(from), to: new Date(from + bucketSeconds * 1000) };
}

/**
 * The window a pointer gesture selects. Under 4 px of movement is a click on
 * the bucket under the pointer; a drag (either direction) snaps its ends out
 * to bucket edges. Buckets are counted from `extent.from` (the first bucket's
 * start) and the result never leaves the extent.
 */
export function pointerSelection(i: {
  downTime: number;
  upTime: number;
  movedPx: number;
  bucketSeconds: number;
  extent: { from: number; to: number };
}): { from: Date; to: Date } {
  const bucketMs = Math.max(1, i.bucketSeconds * 1000);
  const { from: start, to: end } = i.extent;
  const count = Math.max(1, Math.ceil((end - start) / bucketMs));
  const clampTime = (t: number) => Math.min(Math.max(t, start), end);

  const bucketAt = (t: number) => {
    const index = Math.min(Math.max(Math.floor((t - start) / bucketMs), 0), count - 1);
    const from = start + index * bucketMs;
    return { from: new Date(from), to: new Date(Math.min(from + bucketMs, end)) };
  };

  if (i.movedPx < 4) return bucketAt(i.downTime);

  const lo = Math.min(i.downTime, i.upTime);
  const hi = Math.max(i.downTime, i.upTime);
  const from = clampTime(start + Math.floor((lo - start) / bucketMs) * bucketMs);
  const to = clampTime(start + Math.ceil((hi - start) / bucketMs) * bucketMs);
  if (to <= from) return bucketAt(lo);
  return { from: new Date(from), to: new Date(to) };
}

interface TooltipParam {
  seriesName?: string;
  value?: unknown;
  color?: unknown;
}

export function buildHistogramOption(i: {
  buckets: LogHistogramBucket[];
  bucketSeconds: number;
  colors: Record<LogLevel, string>;
  formatAxis: (ms: number) => string;
}): EChartsOption {
  const bucketMs = i.bucketSeconds * 1000;
  const starts = i.buckets.map((b) => Date.parse(b.time));
  const axisStyle = getAxisStyle();
  const tooltipStyle = getTooltipStyle();

  const series = LOG_LEVELS.map((level) => ({
    name: LEVEL_SERIES_NAMES[level],
    type: 'bar' as const,
    stack: 'level',
    // A bar is centred on its x value, so the middle of the bucket makes it cover the bucket.
    data: i.buckets.map((b, index) => [starts[index] + bucketMs / 2, b.byLevel[level] ?? 0] as [number, number]),
    itemStyle: { color: i.colors[level] },
    barCategoryGap: '10%',
    barMaxWidth: 48,
    emphasis: { focus: 'series' as const },
  }));

  const min = starts.length > 0 ? starts[0] : undefined;
  const max = starts.length > 0 ? starts[starts.length - 1] + bucketMs : undefined;

  return {
    animation: false,
    grid: { left: 8, right: 8, top: 8, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      ...tooltipStyle,
      formatter: (raw: unknown) => {
        const params = (Array.isArray(raw) ? raw : [raw]) as TooltipParam[];
        const first = params[0]?.value;
        const x = Array.isArray(first) ? Number(first[0]) : NaN;
        const head = Number.isFinite(x) ? i.formatAxis(x - bucketMs / 2) : '';
        let total = 0;
        const rows = params.map((p) => {
          const v = Array.isArray(p.value) ? Number(p.value[1]) || 0 : 0;
          total += v;
          const color = typeof p.color === 'string' ? p.color : 'currentColor';
          return `<div style="display:flex;justify-content:space-between;gap:12px"><span><span style="display:inline-block;width:8px;height:8px;border-radius:9999px;margin-right:6px;background:${color}"></span>${p.seriesName ?? ''}</span><span>${v.toLocaleString('en-US')}</span></div>`;
        });
        return `<div style="font-weight:600;margin-bottom:4px">${head}</div>${rows.join('')}<div style="display:flex;justify-content:space-between;gap:12px;margin-top:4px"><span>Total</span><span>${total.toLocaleString('en-US')}</span></div>`;
      },
    },
    xAxis: {
      type: 'time',
      min,
      max,
      axisLabel: { ...axisStyle.axisLabel, formatter: (value: number) => i.formatAxis(value), hideOverlap: true },
      axisLine: axisStyle.axisLine,
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitNumber: 2,
      axisLabel: { ...axisStyle.axisLabel, formatter: (value: number) => value.toLocaleString('en-US') },
      splitLine: axisStyle.splitLine,
    },
    series,
  } as EChartsOption;
}
