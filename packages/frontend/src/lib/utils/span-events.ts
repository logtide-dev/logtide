import type { SpanRecord, TraceErrorGroup } from '$lib/api/traces';

export interface ExceptionInfo {
  time: string;
  type: string | null;
  message: string | null;
  stacktrace: string | null;
}

function asText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Exception events of a span, attributes coerced to text. Never rendered as HTML. */
export function extractExceptions(span: SpanRecord): ExceptionInfo[] {
  const events = Array.isArray(span.events) ? span.events : [];
  const out: ExceptionInfo[] = [];
  for (const event of events) {
    if (!event || event.name !== 'exception') continue;
    const attrs =
      event.attributes && typeof event.attributes === 'object'
        ? (event.attributes as Record<string, unknown>)
        : {};
    out.push({
      time: typeof event.time === 'string' ? event.time : '',
      type: asText(attrs['exception.type']),
      message: asText(attrs['exception.message']),
      stacktrace: asText(attrs['exception.stacktrace']),
    });
  }
  return out;
}

/**
 * Error group that belongs to a span: the group recorded for exactly this
 * span, else the same exception type, else, for an ERROR span with a single
 * group in the trace, that group.
 */
export function matchErrorGroup(span: SpanRecord, groups: TraceErrorGroup[]): TraceErrorGroup | null {
  if (!groups || groups.length === 0) return null;

  const bySpan = groups.find((g) => g.spanId !== null && g.spanId === span.span_id);
  if (bySpan) return bySpan;

  const types = new Set(extractExceptions(span).map((e) => e.type).filter((t): t is string => !!t));
  if (types.size > 0) {
    const byType = groups.find((g) => types.has(g.exceptionType));
    if (byType) return byType;
  }

  if (span.status_code === 'ERROR' && groups.length === 1) return groups[0];
  return null;
}
