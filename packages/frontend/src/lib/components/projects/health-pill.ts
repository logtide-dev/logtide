import type { ProjectHealthSummaryEntry } from '$lib/api/project-health';

export interface HealthPillModel {
  kind: 'healthy' | 'warning' | 'critical' | 'inactive' | 'no_data';
  text: string;
}

/** Muted issues never count towards the pill. */
export function describeHealth(entry: ProjectHealthSummaryEntry): HealthPillModel {
  if (entry.status === 'no_data') return { kind: 'no_data', text: 'No data yet' };
  const open = entry.openIssues.filter((i) => !i.muted);
  const critical = open.filter((i) => i.severity === 'critical').length;
  if (critical > 0) return { kind: 'critical', text: `${critical.toLocaleString('en-US')} critical` };
  const warnings = open.length;
  if (warnings > 0) {
    return {
      kind: 'warning',
      text: `${warnings.toLocaleString('en-US')} ${warnings === 1 ? 'warning' : 'warnings'}`,
    };
  }
  // Idle without an alerting silent check: neutral, not a problem.
  if (entry.status === 'inactive') return { kind: 'inactive', text: 'Inactive' };
  return { kind: 'healthy', text: 'Healthy' };
}
