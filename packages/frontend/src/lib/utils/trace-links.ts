import { addFieldClause } from '@logtide/shared';
import { resolveRange, writeScopeToUrl, type TimeRangeValue } from '$lib/stores/scope-url';

// Every cross-area link of the Traces pages is built here so the window and
// the scope params (`project`, `range` or `from`+`to`) are always right.

const PAD_MS = 5 * 60 * 1000;

type RangeInput = TimeRangeValue | { from: Date; to: Date };

function isTimeRangeValue(range: RangeInput): range is TimeRangeValue {
  return 'kind' in range;
}

/** `/path?a=b&c=d`, or just the path when there are no params. */
function withQuery(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function paddedWindow(trace: { start_time: string; end_time: string }): { from: string; to: string } | null {
  const start = new Date(trace.start_time).getTime();
  const end = new Date(trace.end_time).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return {
    from: new Date(start - PAD_MS).toISOString(),
    to: new Date(end + PAD_MS).toISOString(),
  };
}

/** Resolved ISO instants, a preset is resolved against now. */
function isoRange(range: RangeInput): { from: string; to: string } {
  const resolved = isTimeRangeValue(range) ? resolveRange(range) : range;
  return { from: resolved.from.toISOString(), to: resolved.to.toISOString() };
}

/** `range=<preset>` for a preset, `from`+`to` otherwise. */
function applyScopeRange(params: URLSearchParams, range: RangeInput): void {
  if (isTimeRangeValue(range)) {
    const written = writeScopeToUrl(new URL('http://x/'), { range });
    for (const [key, value] of written.searchParams) params.set(key, value);
    return;
  }
  params.set('from', range.from.toISOString());
  params.set('to', range.to.toISOString());
}

export function traceDetailUrl(traceId: string, projectId?: string | null): string {
  const params = new URLSearchParams();
  if (projectId) params.set('project', projectId);
  return withQuery(`/dashboard/traces/${encodeURIComponent(traceId)}`, params);
}

export function traceLogsUrl(
  trace: { trace_id: string; start_time: string; end_time: string },
  projectId: string
): string {
  const params = new URLSearchParams();
  params.set('q', addFieldClause('', 'trace', trace.trace_id, false));
  params.set('project', projectId);
  const window = paddedWindow(trace);
  if (window) {
    params.set('from', window.from);
    params.set('to', window.to);
  }
  return withQuery('/dashboard/logs', params);
}

export function spanLogsUrl(
  span: { span_id: string },
  trace: { start_time: string; end_time: string },
  projectId: string
): string {
  const params = new URLSearchParams();
  params.set('q', addFieldClause('', 'span', span.span_id, false));
  params.set('project', projectId);
  const window = paddedWindow(trace);
  if (window) {
    params.set('from', window.from);
    params.set('to', window.to);
  }
  return withQuery('/dashboard/logs', params);
}

export function serviceLogsUrl(service: string, projectId: string, range: RangeInput): string {
  const params = new URLSearchParams();
  params.set('q', addFieldClause('', 'service', service, false));
  params.set('project', projectId);
  const iso = isoRange(range);
  params.set('from', iso.from);
  params.set('to', iso.to);
  return withQuery('/dashboard/logs', params);
}

export function serviceErrorsUrl(service: string, projectId: string, range: RangeInput): string {
  const params = new URLSearchParams();
  params.set('project', projectId);
  params.set('service', service);
  applyScopeRange(params, range);
  return withQuery('/dashboard/errors', params);
}

export function tracesForServiceUrl(service: string, projectId: string, range: RangeInput): string {
  const params = new URLSearchParams();
  params.set('project', projectId);
  params.set('service', service);
  applyScopeRange(params, range);
  return withQuery('/dashboard/traces', params);
}

export function errorGroupUrl(errorGroupId: string, projectId: string): string {
  const params = new URLSearchParams();
  params.set('project', projectId);
  return withQuery(`/dashboard/errors/${encodeURIComponent(errorGroupId)}`, params);
}
