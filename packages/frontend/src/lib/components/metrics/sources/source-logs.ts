// Pure rules of the Logs tab of a source page: the query it runs, the filters
// it offers and the links it builds. No I/O, so every branch is unit tested.

import { LOG_LEVELS, quoteFieldValue, type LogLevel, type MetricSourceKind } from '@logtide/shared';
import { buildLogsUrl } from '$lib/components/search/explorer-url';

/** Levels in the order the tab shows them: the worst first. */
export const TAB_LEVELS: readonly LogLevel[] = [...LOG_LEVELS].reverse();

export interface SourceLogsFilters {
  /** Selected levels; empty means every level. */
  levels: LogLevel[];
  /** Selected services (host pages only); empty means every service. */
  services: string[];
  /** Free text, appended to the query as typed. */
  text: string;
}

export const EMPTY_FILTERS: SourceLogsFilters = { levels: [], services: [], text: '' };

/** `host:vps-app` or `service:"checkout api"`: the clause every query of the tab starts with. */
export function sourceClause(kind: MetricSourceKind, name: string): string {
  return `${kind === 'host' ? 'host' : 'service'}:${quoteFieldValue(name)}`;
}

function listClause(field: string, values: string[]): string | null {
  if (values.length === 0) return null;
  const quoted = values.map((v) => quoteFieldValue(v));
  return quoted.length === 1 ? `${field}:${quoted[0]}` : `${field}:(${quoted.join(' OR ')})`;
}

/** The log query of the tab: source clause, then level, service and free text. */
export function buildSourceLogsQuery(kind: MetricSourceKind, name: string, filters: SourceLogsFilters): string {
  const parts = [
    sourceClause(kind, name),
    listClause('level', filters.levels),
    kind === 'host' ? listClause('service', filters.services) : null,
    filters.text.trim() || null,
  ];
  return parts.filter((p): p is string => !!p).join(' ');
}

/** Adds the value to a multi-select filter, or removes it when it is already selected. */
export function toggleValue<T>(selected: T[], value: T): T[] {
  return selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
}

/** Logs explorer with the same query and window; with `logId` it opens centred on that log. */
export function sourceLogsHref(input: {
  query: string;
  projectIds: string[];
  from: string;
  to: string;
  logId?: string;
  logProjectId?: string;
}): string {
  return buildLogsUrl({
    q: input.query,
    projectIds: input.projectIds,
    from: input.from,
    to: input.to,
    ...(input.logId ? { logId: input.logId, logProjectId: input.logProjectId } : {}),
  });
}
