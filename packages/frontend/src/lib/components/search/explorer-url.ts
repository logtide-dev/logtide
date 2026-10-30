// Logs explorer URL state (spec 5.4): parse the canonical params plus every
// legacy deep-link param, write the canonical URL, and build the links other
// features hand out (permalinks, alert pre-fill, saved searches).
//
// Times in URLs are absolute instants (ISO with `Z`); only labels follow the
// display time zone.

import { LOG_LEVELS, parseLogQuery, type TimeRangePreset } from '@logtide/shared';
import {
  readScopeFromUrl,
  writeScopeToUrl,
  type Scope,
  type TimeRangeValue,
} from '$lib/stores/scope-url';
import type { SavedSearch, SavedSearchState } from '$lib/api/saved-searches';
import { appendClause, formatFieldClause, getFieldValues, quotePhrase } from './query-edit';

export type ExplorerView = 'table' | 'terminal';

export const LOGS_PATH = '/dashboard/logs';
export const LOG_LINK_WINDOW_MS = 5 * 60 * 1000;

const ALERTS_PATH = '/dashboard/alerts';
const ALERT_NAME_MAX = 80;
const URL_BASE = 'http://explorer.local';

export interface ExplorerState {
  q: string;
  projectIds: string[];
  range: TimeRangeValue;
  view: ExplorerView;
  live: boolean;
  logId: string | null;
  logProjectId: string | null;
  savedId: string | null;
}

export interface ParsedExplorerUrl {
  q: string;
  scope: Partial<Scope>;
  view: ExplorerView | null;
  live: boolean;
  logId: string | null;
  logProjectId: string | null;
  savedId: string | null;
  /** True when the URL used pre-1.6 params; the page then rewrites it canonically. */
  legacy: boolean;
}

export interface LogsLinkInput {
  q?: string;
  projectIds?: string[];
  range?: TimeRangePreset;
  from?: string | Date;
  to?: string | Date;
  logId?: string;
  logProjectId?: string;
  live?: boolean;
  view?: ExplorerView;
}

/** Legacy filter params, in the order their clauses are appended to `q`. */
const LEGACY_FIELDS: { params: string[]; key: string; list: boolean }[] = [
  { params: ['service'], key: 'service', list: true },
  { params: ['level', 'levels'], key: 'level', list: true },
  { params: ['hostname'], key: 'host', list: true },
  { params: ['traceId'], key: 'trace', list: false },
  { params: ['sessionId'], key: 'session', list: false },
  { params: ['spanId'], key: 'span', list: false },
];

const LEGACY_ONLY_PARAMS = ['projectId', 'mode', 'searchMode'];

const KNOWN_LEVELS = new Set<string>(LOG_LEVELS);

function nonEmpty(value: string | null): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function splitList(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    for (const part of value.split(',')) {
      const v = part.trim();
      if (v && !out.includes(v)) out.push(v);
    }
  }
  return out;
}

/** Appends a clause unless that turns a parseable query into one the grammar rejects. */
function appendIfValid(q: string, clause: string): string {
  if (!clause) return q;
  const next = appendClause(q, clause);
  if (!parseLogQuery(q).ok) return next;
  return parseLogQuery(next).ok ? next : q;
}

function legacyValues(p: URLSearchParams, field: (typeof LEGACY_FIELDS)[number]): string[] {
  // `level` wins over its alias `levels` when both are present.
  const name = field.params.find((param) => p.has(param));
  if (!name) return [];
  const raw = p.getAll(name);
  let values = field.list ? splitList(raw) : raw.map((v) => v.trim()).filter(Boolean).slice(0, 1);
  if (field.key === 'level') {
    values = values.map((v) => v.toLowerCase()).filter((v) => KNOWN_LEVELS.has(v));
  }
  return values;
}

export function parseExplorerUrl(url: URL): ParsedExplorerUrl {
  const p = url.searchParams;
  const scope = readScopeFromUrl(url);

  let q = (p.get('q') ?? '').trim();
  const substring = p.get('mode') === 'substring' || p.get('searchMode') === 'substring';
  if (substring && q) q = quotePhrase(q);

  let legacy = LEGACY_ONLY_PARAMS.some((name) => p.has(name));
  for (const field of LEGACY_FIELDS) {
    if (field.params.some((name) => p.has(name))) legacy = true;
    q = appendIfValid(q, formatFieldClause(field.key, legacyValues(p, field), false));
  }

  const viewParam = p.get('view');
  const view: ExplorerView | null = viewParam === 'table' || viewParam === 'terminal' ? viewParam : null;
  const logId = nonEmpty(p.get('logId'));
  const singleProject = scope.projectIds?.length === 1 ? scope.projectIds[0] : null;
  const logProjectId = logId
    ? (nonEmpty(p.get('logProject')) ?? nonEmpty(p.get('projectId')) ?? singleProject)
    : null;

  return {
    q,
    scope,
    view,
    live: p.get('live') === 'true',
    logId,
    logProjectId,
    savedId: nonEmpty(p.get('saved')),
    legacy,
  };
}

interface UrlParts {
  q?: string;
  projectIds?: string[];
  range?: TimeRangeValue;
  view?: ExplorerView;
  live?: boolean;
  logId?: string | null;
  logProjectId?: string | null;
  savedId?: string | null;
}

function pathOf(url: URL): string {
  return `${url.pathname}${url.search}`;
}

function buildUrl(parts: UrlParts): URL {
  let url = new URL(LOGS_PATH, URL_BASE);
  const q = parts.q?.trim();
  if (q) url.searchParams.set('q', q);
  if (parts.range || parts.projectIds) {
    url = writeScopeToUrl(url, { range: parts.range, projectIds: parts.projectIds });
  }
  if (parts.view) url.searchParams.set('view', parts.view);
  if (parts.live) url.searchParams.set('live', 'true');
  if (parts.logId) {
    url.searchParams.set('logId', parts.logId);
    const ids = parts.projectIds ?? [];
    const onlyThatProject = ids.length === 1 && ids[0] === parts.logProjectId;
    if (parts.logProjectId && !onlyThatProject) url.searchParams.set('logProject', parts.logProjectId);
  }
  if (parts.savedId) url.searchParams.set('saved', parts.savedId);
  return url;
}

/** Canonical explorer URL (path and query): `range` or `from`/`to` and `view` are always written. */
export function buildExplorerUrl(state: ExplorerState): string {
  return pathOf(buildUrl(state));
}

function toIso(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

/** Explorer link for other pages; only the given parts are written (the page keeps its stored scope otherwise). */
export function buildLogsUrl(input: LogsLinkInput): string {
  let range: TimeRangeValue | undefined;
  if (input.range) range = { kind: 'preset', preset: input.range };
  else if (input.from !== undefined && input.to !== undefined) {
    range = { kind: 'custom', from: toIso(input.from), to: toIso(input.to) };
  }
  return pathOf(
    buildUrl({
      q: input.q,
      projectIds: input.projectIds,
      range,
      view: input.view,
      live: input.live,
      logId: input.logId,
      logProjectId: input.logProjectId,
    }),
  );
}

/** Absolute link to one log: its project, a window of log time +/- 5 minutes, centred on the log. */
export function logPermalink(log: { id: string; projectId: string; time: string }, origin: string): string {
  const t = new Date(log.time).getTime();
  const path = buildLogsUrl({
    projectIds: [log.projectId],
    from: new Date(t - LOG_LINK_WINDOW_MS),
    to: new Date(t + LOG_LINK_WINDOW_MS),
    logId: log.id,
    logProjectId: log.projectId,
  });
  return `${origin.replace(/\/+$/, '')}${path}`;
}

/** Alert builder pre-filled with the explorer query and scope (spec 5.10 contract). */
export function alertPrefillUrl(input: { q: string; scopeProjectIds: string[] }): string {
  const url = new URL(ALERTS_PATH, URL_BASE);
  const p = url.searchParams;
  const q = input.q.trim();
  p.set('create', '1');
  if (input.scopeProjectIds.length === 1) p.set('projectId', input.scopeProjectIds[0]);
  if (q) p.set('query', q);

  const level = getFieldValues(q, 'level');
  const levels =
    level.include.length > 0 ? level.include : LOG_LEVELS.filter((l) => !level.exclude.includes(l));
  p.set('levels', levels.join(','));

  const service = getFieldValues(q, 'service').include;
  if (service.length === 1) p.set('service', service[0]);

  if (q) {
    const name = `Logs matching ${q}`;
    p.set('name', name.length > ALERT_NAME_MAX ? `${name.slice(0, ALERT_NAME_MAX - 3)}...` : name);
  }
  return pathOf(url);
}

/** Explorer state as stored with a saved search: preset as `range`, custom as `from`/`to`. */
export function toSavedState(state: ExplorerState, columns: string[]): SavedSearchState {
  const saved: SavedSearchState = { q: state.q, projectIds: [...state.projectIds] };
  if (state.range.kind === 'preset') saved.range = state.range.preset;
  else {
    saved.from = state.range.from;
    saved.to = state.range.to;
  }
  saved.view = state.view;
  if (columns.length > 0) saved.columns = [...columns];
  return saved;
}

/** Explorer URL that opens a saved search (the range is left alone when the state has none). */
export function savedSearchUrl(saved: Pick<SavedSearch, 'id' | 'state'>): string {
  const { state } = saved;
  let range: TimeRangeValue | undefined;
  if (state.range) range = { kind: 'preset', preset: state.range };
  else if (state.from && state.to) range = { kind: 'custom', from: state.from, to: state.to };
  return pathOf(
    buildUrl({ q: state.q, projectIds: state.projectIds, range, view: state.view, savedId: saved.id }),
  );
}
