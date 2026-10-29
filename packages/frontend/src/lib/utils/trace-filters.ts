import type { TraceFilters } from '$lib/api/traces';

// Traces list state that lives in the URL, next to the shared scope params
// (`project`, `range` or `from`+`to`) which are owned by the scope store and
// never touched here.

export interface TraceUrlFilters {
  service?: string;
  operation?: string;
  status?: 'errors' | 'ok';
  /** Milliseconds. */
  minDuration?: number;
  maxDuration?: number;
  /** Whitespace separated field clauses, see the log query grammar. */
  attr?: string;
  sortBy: 'start_time' | 'duration';
  sortOrder: 'asc' | 'desc';
  page: number;
  view: 'list' | 'map';
}

export const DEFAULT_TRACE_SORT_BY: TraceUrlFilters['sortBy'] = 'start_time';
export const DEFAULT_TRACE_SORT_ORDER: TraceUrlFilters['sortOrder'] = 'desc';

const LIST_STATE_KEY = 'logtide_traces_list_state';

function text(raw: string | null): string | undefined {
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

function duration(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function parseTraceFilters(url: URL): TraceUrlFilters {
  const p = url.searchParams;

  const status = p.get('status');
  const sortBy = p.get('sortBy');
  const sortOrder = p.get('sortOrder');
  const view = p.get('view');
  const pageRaw = Number(p.get('page'));

  const filters: TraceUrlFilters = {
    sortBy: sortBy === 'duration' ? 'duration' : DEFAULT_TRACE_SORT_BY,
    sortOrder: sortOrder === 'asc' ? 'asc' : DEFAULT_TRACE_SORT_ORDER,
    page: Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1,
    view: view === 'map' ? 'map' : 'list',
  };

  const service = text(p.get('service'));
  if (service !== undefined) filters.service = service;
  const operation = text(p.get('operation'));
  if (operation !== undefined) filters.operation = operation;
  if (status === 'errors' || status === 'ok') filters.status = status;
  const minDuration = duration(p.get('minDuration'));
  if (minDuration !== undefined) filters.minDuration = minDuration;
  const maxDuration = duration(p.get('maxDuration'));
  if (maxDuration !== undefined) filters.maxDuration = maxDuration;
  const attr = text(p.get('attr'));
  if (attr !== undefined) filters.attr = attr;

  return filters;
}

function setOrDelete(p: URLSearchParams, key: string, value: string | number | undefined | null) {
  if (value === undefined || value === null || value === '') p.delete(key);
  else p.set(key, String(value));
}

/**
 * Writes only the keys present in `filters`; defaults and empty values are
 * removed so shared links stay short. Scope params are left alone.
 */
export function writeTraceFilters(url: URL, filters: Partial<TraceUrlFilters>): URL {
  const next = new URL(url.href);
  const p = next.searchParams;

  if ('service' in filters) setOrDelete(p, 'service', filters.service);
  if ('operation' in filters) setOrDelete(p, 'operation', filters.operation);
  if ('status' in filters) setOrDelete(p, 'status', filters.status);
  if ('minDuration' in filters) setOrDelete(p, 'minDuration', filters.minDuration);
  if ('maxDuration' in filters) setOrDelete(p, 'maxDuration', filters.maxDuration);
  if ('attr' in filters) setOrDelete(p, 'attr', filters.attr?.trim());
  if ('sortBy' in filters) {
    setOrDelete(p, 'sortBy', filters.sortBy === DEFAULT_TRACE_SORT_BY ? undefined : filters.sortBy);
  }
  if ('sortOrder' in filters) {
    setOrDelete(p, 'sortOrder', filters.sortOrder === DEFAULT_TRACE_SORT_ORDER ? undefined : filters.sortOrder);
  }
  if ('page' in filters) {
    setOrDelete(p, 'page', filters.page && filters.page > 1 ? filters.page : undefined);
  }
  if ('view' in filters) setOrDelete(p, 'view', filters.view === 'map' ? 'map' : undefined);

  return next;
}

/** Maps URL state and the resolved range onto the API list query. */
export function toListQuery(
  filters: TraceUrlFilters,
  range: { from: Date; to: Date },
  projectId: string,
  pageSize: number
): TraceFilters {
  const query: TraceFilters = {
    projectId,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    limit: pageSize,
    offset: (Math.max(1, filters.page) - 1) * pageSize,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
  };
  if (filters.service) query.service = filters.service;
  if (filters.operation) query.operation = filters.operation;
  if (filters.status === 'errors') query.error = true;
  else if (filters.status === 'ok') query.error = false;
  if (filters.minDuration !== undefined) query.minDurationMs = filters.minDuration;
  if (filters.maxDuration !== undefined) query.maxDurationMs = filters.maxDuration;
  if (filters.attr) query.attr = filters.attr;
  return query;
}

/** Remembers the list query string so "Back to traces" can restore it. */
export function rememberTraceListState(search: string): void {
  try {
    sessionStorage.setItem(LIST_STATE_KEY, search);
  } catch {
    // Storage can be unavailable or blocked; the back link falls back to a default.
  }
}

export function readTraceListState(): string | null {
  try {
    return sessionStorage.getItem(LIST_STATE_KEY);
  } catch {
    return null;
  }
}
