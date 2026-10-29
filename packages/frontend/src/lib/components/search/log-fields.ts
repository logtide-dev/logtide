// Defensive accessors for log rows: payloads may carry null metadata, a
// numeric `metadata.hostname` or breadcrumbs of any shape, and none of that
// may break a row, a filter action or the details panel.

import type { LogEntry } from '$lib/api/logs';

/** Same shape as the items of BreadcrumbTimeline's `breadcrumbs` prop. */
export interface Breadcrumb {
  type: string;
  category?: string;
  message: string;
  level?: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Top-level `hostname` when it is a non-empty string, else a string `metadata.hostname`, else null. */
export function logHostname(log: LogEntry): string | null {
  if (typeof log.hostname === 'string' && log.hostname !== '') return log.hostname;
  const metadata = log.metadata;
  if (!isPlainObject(metadata)) return null;
  const host = metadata.hostname;
  return typeof host === 'string' && host !== '' ? host : null;
}

/** A metadata value usable as a filter value: strings as is, finite numbers and booleans as text. */
export function metadataFilterValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return String(value);
  return null;
}

/** Metadata for the details tree: a plain object without `breadcrumbs`, null when nothing is left. */
export function detailsMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!isPlainObject(metadata)) return null;
  const { breadcrumbs: _breadcrumbs, ...rest } = metadata;
  return Object.keys(rest).length > 0 ? rest : null;
}

/** `metadata.breadcrumbs` when it is an array, else an empty list. */
export function logBreadcrumbs(log: LogEntry): Breadcrumb[] {
  const metadata = log.metadata;
  if (!isPlainObject(metadata)) return [];
  const crumbs = metadata.breadcrumbs;
  return Array.isArray(crumbs) ? (crumbs as Breadcrumb[]) : [];
}

/** The project whose per-project settings (columns, pins) apply: the first scoped one. */
export function activeProjectKey(projectIds: string[]): string | null {
  return projectIds.length > 0 ? projectIds[0] : null;
}

/** Stable key for keyed lists: the log id, else time plus position. */
export function rowKey(log: LogEntry, index: number): string {
  return log.id ?? `${log.time}-${index}`;
}
