import type { SpanRecord } from '$lib/api/traces';
import { stateTone } from '$lib/utils/severity';

export const MIN_BAR_WIDTH_PERCENT = 0.5;

const FALLBACK_BAR: { left: number; width: number } = { left: 0, width: MIN_BAR_WIDTH_PERCENT };

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Position of a span bar in percent of the trace window. Always inside
 * 0-100, at least MIN_BAR_WIDTH_PERCENT wide, and finite for zero durations,
 * a span that starts before the trace, or a missing or inverted end time.
 */
export function barGeometry(
  span: Pick<SpanRecord, 'start_time' | 'end_time' | 'duration_ms'>,
  traceStartMs: number,
  traceDurationMs: number
): { left: number; width: number } {
  const start = new Date(span.start_time).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(traceStartMs)) return { ...FALLBACK_BAR };

  const parsedEnd = span.end_time ? new Date(span.end_time).getTime() : NaN;
  const duration = Number.isFinite(span.duration_ms) && span.duration_ms > 0 ? span.duration_ms : 0;
  let end = Number.isFinite(parsedEnd) ? parsedEnd : start + duration;
  if (end < start) end = start + duration;

  if (!Number.isFinite(traceDurationMs) || traceDurationMs <= 0) {
    return { left: 0, width: 100 };
  }

  const traceEnd = traceStartMs + traceDurationMs;
  const visibleStart = clamp(start, traceStartMs, traceEnd);
  const visibleEnd = clamp(end, traceStartMs, traceEnd);

  const left = ((visibleStart - traceStartMs) / traceDurationMs) * 100;
  const rawWidth = ((visibleEnd - visibleStart) / traceDurationMs) * 100;
  const width = Math.max(rawWidth, MIN_BAR_WIDTH_PERCENT);

  // Keep the bar inside the track even when it is pushed to the right edge.
  const safeLeft = clamp(left, 0, 100 - Math.min(width, 100));
  return { left: safeLeft, width: Math.min(width, 100 - safeLeft) };
}

// Semantic tokens only: each one carries its own dark variant in app.css and
// none of them reads as an error colour.
const SERVICE_BARS = ['bg-info', 'bg-primary', 'bg-critical', 'bg-success', 'bg-foreground/50'] as const;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Bar colour: the failed tone for ERROR spans, otherwise a stable pick per service. */
export function spanBarClass(span: Pick<SpanRecord, 'status_code' | 'service_name'>): string {
  if (span.status_code === 'ERROR') return stateTone('failed').dot;
  return SERVICE_BARS[hash(span.service_name ?? '') % SERVICE_BARS.length];
}
