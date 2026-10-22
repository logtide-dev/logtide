import type { PublicMonitorStatus } from '$lib/api/status-page';

export interface MonitorGroup {
  name: string | null;
  monitors: PublicMonitorStatus[];
}

/**
 * Ungrouped components come first (no heading), then named groups in the order
 * of their first appearance. The monitor order inside a group is kept.
 */
export function groupMonitors(monitors: PublicMonitorStatus[]): MonitorGroup[] {
  const ungrouped: PublicMonitorStatus[] = [];
  const named = new Map<string, PublicMonitorStatus[]>();
  for (const m of monitors) {
    const name = m.groupName?.trim();
    if (!name) {
      ungrouped.push(m);
      continue;
    }
    const list = named.get(name);
    if (list) list.push(m);
    else named.set(name, [m]);
  }
  const groups: MonitorGroup[] = [];
  if (ungrouped.length > 0) groups.push({ name: null, monitors: ungrouped });
  for (const [name, list] of named) groups.push({ name, monitors: list });
  return groups;
}
