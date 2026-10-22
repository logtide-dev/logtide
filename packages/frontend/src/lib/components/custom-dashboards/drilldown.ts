// ============================================================================
// Panel drill-down links
// ============================================================================
//
// Pure helper: maps a panel config to a link into Logs or Traces that carries
// the panel's own scope (project, window, service, levels). The dashboard-level
// time override replaces the panel window except where the backend ignores it
// (live streams), mirroring `applyTimeRangeOverride`.

import type { LogLevelKey, PanelConfig, PanelTimeRange } from '@logtide/shared';
import { writeScopeToUrl } from '$lib/stores/scope-url';

export type PanelDrilldown = {
  href: string;
  label: 'Open in Logs' | 'Open in Traces';
};

const ALL_LEVELS: readonly LogLevelKey[] = ['debug', 'info', 'warn', 'error', 'critical'];
const BASE = 'http://localhost';

function quoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function levelClause(levels: readonly LogLevelKey[] | undefined): string | null {
  if (!levels || levels.length === 0) return null;
  const unique = ALL_LEVELS.filter((l) => levels.includes(l));
  if (unique.length === 0 || unique.length === ALL_LEVELS.length) return null;
  return unique.length === 1 ? `level:${unique[0]}` : `level:(${unique.join(' OR ')})`;
}

function buildUrl(
  path: string,
  projectId: string | null,
  range: PanelTimeRange,
  extra: Record<string, string>
): string {
  const base = new URL(path, BASE);
  const url = writeScopeToUrl(base, {
    ...(projectId ? { projectIds: [projectId] } : {}),
    range: { kind: 'preset', preset: range },
  });
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

function logsLink(
  projectId: string | null,
  range: PanelTimeRange,
  clauses: Array<string | null>
): PanelDrilldown {
  const q = clauses.filter((c): c is string => Boolean(c)).join(' ');
  return {
    href: buildUrl('/dashboard/logs', projectId, range, q ? { q } : {}),
    label: 'Open in Logs',
  };
}

export function panelDrilldown(
  config: PanelConfig,
  override?: PanelTimeRange | null
): PanelDrilldown | null {
  switch (config.type) {
    case 'time_series':
      return logsLink(config.projectId, override ?? config.interval, [
        levelClause(config.levels),
        config.service ? `service:${quoted(config.service)}` : null,
      ]);
    case 'top_n_table': {
      const clauses: Array<string | null> = [];
      if (config.dimension === 'metadata') {
        clauses.push(levelClause(config.levels));
        if (config.service) clauses.push(`service:${quoted(config.service)}`);
      } else if (config.dimension === 'error_message') {
        clauses.push('level:(error OR critical)');
      }
      return logsLink(config.projectId, override ?? config.interval, clauses);
    }
    case 'live_log_stream':
      // Live streams ignore the dashboard override.
      return logsLink(config.projectId, '1h', [
        levelClause(config.levels),
        config.service ? `service:${quoted(config.service)}` : null,
      ]);
    case 'log_table':
      return logsLink(
        config.projectId,
        config.mode === 'live' ? config.timeRange : (override ?? config.timeRange),
        [levelClause(config.levels), config.service ? `service:${quoted(config.service)}` : null]
      );
    case 'geo_map':
      return logsLink(config.projectId, override ?? config.interval, [
        levelClause(config.levels),
        config.service ? `service:${quoted(config.service)}` : null,
        config.hostname ? `host:${quoted(config.hostname)}` : null,
      ]);
    case 'single_stat':
      return logsLink(config.projectId, override ?? '24h', [
        config.metric === 'error_rate' ? 'level:(error OR critical)' : null,
      ]);
    case 'trace_latency':
    case 'trace_volume':
      return {
        href: buildUrl(
          '/dashboard/traces',
          config.projectId,
          override ?? config.timeRange,
          config.serviceName ? { service: config.serviceName } : {}
        ),
        label: 'Open in Traces',
      };
    default:
      return null;
  }
}
