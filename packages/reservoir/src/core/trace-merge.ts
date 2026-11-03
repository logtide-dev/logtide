import type { TraceRecord } from './types.js';

/**
 * Merges two partial summaries of the same trace with the upsertTraces
 * semantics: span counts add up, the window widens, error is sticky, and root
 * names from `next` win only when it carries them.
 */
export function mergeTraceSummary(prev: TraceRecord, next: TraceRecord): TraceRecord {
  const startTime = next.startTime.getTime() < prev.startTime.getTime() ? next.startTime : prev.startTime;
  const endTime = next.endTime.getTime() > prev.endTime.getTime() ? next.endTime : prev.endTime;
  return {
    ...prev,
    organizationId: prev.organizationId ?? next.organizationId,
    rootServiceName: next.rootServiceName ?? prev.rootServiceName,
    rootOperationName: next.rootOperationName ?? prev.rootOperationName,
    startTime,
    endTime,
    durationMs: endTime.getTime() - startTime.getTime(),
    spanCount: prev.spanCount + next.spanCount,
    error: prev.error || next.error,
  };
}

/** Collapses repeated (projectId, traceId) entries of one call into one summary each, first-seen order. */
export function collapseTraceSummaries(traces: TraceRecord[]): TraceRecord[] {
  const byKey = new Map<string, TraceRecord>();
  for (const trace of traces) {
    const key = `${trace.projectId}|${trace.traceId}`;
    const prev = byKey.get(key);
    byKey.set(key, prev ? mergeTraceSummary(prev, trace) : trace);
  }
  return [...byKey.values()];
}
