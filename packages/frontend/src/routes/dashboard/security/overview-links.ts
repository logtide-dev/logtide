import type { DetectionEvent } from '@logtide/shared';
import { timeRangePresetToMs } from '@logtide/shared';
import { logLink } from '$lib/components/siem/shared/log-link';
import type { TimeRangeValue } from '$lib/stores/scope';

export type SecurityRange = '24h' | '7d' | '30d';

const SECURITY_RANGES: SecurityRange[] = ['24h', '7d', '30d'];

/**
 * Link to the incidents inbox restricted to Sigma-sourced incidents.
 * `source=sigma` always comes first, then the given filters.
 */
export function incidentsLink(filter: {
  ruleId?: string;
  service?: string;
  technique?: string;
}): string {
  const params = new URLSearchParams();
  params.set('source', 'sigma');
  if (filter.ruleId) params.set('ruleId', filter.ruleId);
  if (filter.service) params.set('service', filter.service);
  if (filter.technique) params.set('technique', filter.technique);
  return `/dashboard/incidents?${params.toString()}`;
}

/**
 * Where a detection row leads: its incident when it has one, otherwise the
 * log that matched. Null when there is nothing to open.
 */
export function detectionLink(
  d: Pick<DetectionEvent, 'incidentId' | 'logId' | 'projectId' | 'time'>
): string | null {
  if (d.incidentId) return `/dashboard/incidents/${encodeURIComponent(d.incidentId)}`;
  if (!d.logId) return null;
  return logLink({ logId: d.logId, projectId: d.projectId, time: d.time });
}

/**
 * The SIEM dashboard API only knows 24h, 7d and 30d. Map any scope range to
 * the smallest of those that covers it.
 */
export function toSecurityRange(range: TimeRangeValue, now: Date = new Date()): SecurityRange {
  let span: number;
  if (range.kind === 'preset') {
    span = timeRangePresetToMs(range.preset);
  } else {
    const from = new Date(range.from).getTime();
    const to = new Date(range.to).getTime();
    span = Number.isNaN(from) || Number.isNaN(to) || to <= from ? timeRangePresetToMs('24h') : to - from;
  }
  void now;
  for (const candidate of SECURITY_RANGES) {
    if (span <= timeRangePresetToMs(candidate)) return candidate;
  }
  return '30d';
}
