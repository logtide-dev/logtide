import { isValidFieldKey, parseLogQuery, quoteFieldValue } from '@logtide/shared';
import type { MetadataFilter } from '@logtide/shared';
import { writeScopeToUrl } from '$lib/stores/scope-url';
import type { AlertBuilderPrefill, AlertHistory, AlertRule } from '$lib/api/alerts';

// Pure view-model helpers for the alerts page: lifecycle state, summaries,
// query composition and the create/edit URL contract. No component imports so
// everything is unit tested without rendering.

export type RuleState = 'firing' | 'ok' | 'snoozed' | 'disabled';

export const RULE_STATE_LABEL: Record<RuleState, string> = {
  firing: 'Firing',
  ok: 'OK',
  snoozed: 'Snoozed',
  disabled: 'Disabled',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const VALID_LEVELS = ['debug', 'info', 'warn', 'error', 'critical'] as const;

function toTime(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Disabled beats snoozed beats firing beats ok. Missing lifecycle fields count as ok. */
export function deriveRuleState(
  rule: Pick<AlertRule, 'enabled' | 'state' | 'snoozedUntil'>,
  now: Date = new Date()
): RuleState {
  if (!rule.enabled) return 'disabled';
  const until = toTime(rule.snoozedUntil);
  if (until !== null && until > now.getTime()) return 'snoozed';
  return rule.state === 'firing' ? 'firing' : 'ok';
}

/** Server count when present, else history rows of that rule newer than 24 h. */
export function countTriggers24h(
  rule: Pick<AlertRule, 'id' | 'triggers24h'>,
  history: Pick<AlertHistory, 'ruleId' | 'triggeredAt'>[],
  now: Date = new Date()
): number {
  if (typeof rule.triggers24h === 'number') return rule.triggers24h;
  const cutoff = now.getTime() - DAY_MS;
  let count = 0;
  for (const row of history) {
    if (row.ruleId !== rule.id) continue;
    const t = toTime(row.triggeredAt);
    if (t !== null && t >= cutoff) count += 1;
  }
  return count;
}

function windowText(minutes: number): string {
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `${d.toLocaleString('en-US')} ${d === 1 ? 'day' : 'days'}`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h.toLocaleString('en-US')} ${h === 1 ? 'hour' : 'hours'}`;
  }
  return `${minutes.toLocaleString('en-US')} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

const BASELINE_TEXT: Record<string, string> = {
  same_time_yesterday: 'the same time yesterday',
  same_day_last_week: 'the same day last week',
  rolling_7d_avg: '7-day rolling avg',
  percentile_p95: '7-day p95',
};

export function summarizeRule(
  rule: Pick<
    AlertRule,
    'alertType' | 'threshold' | 'timeWindow' | 'deviationMultiplier' | 'baselineType'
  >
): string {
  if (rule.alertType === 'rate_of_change') {
    const mult = rule.deviationMultiplier ?? 3;
    const baseline = BASELINE_TEXT[rule.baselineType ?? 'rolling_7d_avg'] ?? 'baseline';
    return `${mult.toLocaleString('en-US')}x above ${baseline}`;
  }
  const n = rule.threshold;
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'log' : 'logs'} in ${windowText(rule.timeWindow)}`;
}

// ---------------------------------------------------------------------------
// Query composition (grammar of spec 5.3)
// ---------------------------------------------------------------------------

export interface ComposeCriteria {
  query?: string | null;
  service?: string | null;
  levels?: string[];
  metadataFilters?: MetadataFilter[];
}

/** True when the clause reads back as exactly one field clause and no free text. */
function parses(clause: string): boolean {
  const r = parseLogQuery(clause);
  return (
    r.ok &&
    r.query.fields.length === 1 &&
    r.query.text.all.length === 0 &&
    r.query.text.anyOf.length === 0 &&
    r.query.text.none.length === 0
  );
}

function listClause(key: string, values: string[]): string {
  const quoted = values.map(quoteFieldValue);
  return quoted.length === 1 ? `${key}:${quoted[0]}` : `${key}:(${quoted.join(' OR ')})`;
}

function metadataClause(f: Pick<MetadataFilter, 'key' | 'op' | 'value' | 'values'>): string | null {
  switch (f.op) {
    case 'equals':
      return f.value === undefined ? null : `${f.key}:${quoteFieldValue(f.value)}`;
    case 'not_equals':
      return f.value === undefined ? null : `-${f.key}:${quoteFieldValue(f.value)}`;
    case 'in':
      return f.values && f.values.length > 0 ? listClause(f.key, f.values) : null;
    case 'not_in':
      return f.values && f.values.length > 0 ? `-${listClause(f.key, f.values)}` : null;
    case 'exists':
      return `${f.key}:*`;
    case 'not_exists':
      return `-${f.key}:*`;
    case 'contains':
      return f.value === undefined ? null : `${f.key}:*${f.value}*`;
    default:
      return null;
  }
}

/**
 * Compose a single search string from rule criteria. A clause that the
 * grammar cannot express (invalid key, value that does not read back) is left
 * out and reported in `skipped`, so the result always parses.
 */
export function composeAlertQuery(c: ComposeCriteria): { q: string; skipped: string[] } {
  const parts: string[] = [];
  const skipped: string[] = [];

  const text = (c.query ?? '').trim();
  if (text) parts.push(text);

  const levels = (c.levels ?? []).filter((l) => l);
  if (levels.length > 0) {
    parts.push(levels.length === 1 ? `level:${levels[0]}` : `level:(${levels.join(' OR ')})`);
  }

  if (c.service) {
    const clause = `service:${quoteFieldValue(c.service)}`;
    if (parses(clause)) parts.push(clause);
    else skipped.push(`service ${c.service}`);
  }

  for (const f of c.metadataFilters ?? []) {
    const clause = isValidFieldKey(f.key) ? metadataClause(f) : null;
    if (clause !== null && parses(clause)) parts.push(clause);
    else skipped.push(`${f.key} ${f.op.replace(/_/g, ' ')}`);
  }

  return { q: parts.join(' '), skipped };
}

export type QueryValidation = { ok: true } | { ok: false; message: string; position: number };

export function validateAlertQuery(q: string): QueryValidation {
  const result = parseLogQuery(q);
  if (result.ok) return { ok: true };
  const { error } = result as { error: { message: string; position: number } };
  return { ok: false, message: error.message, position: error.position };
}

export interface MatchedLogsCriteria extends ComposeCriteria {
  projectId: string | null;
  triggeredAt: string | Date;
  windowMinutes: number;
}

/** Logs link over `[triggeredAt - window, triggeredAt]` using every criterion of the rule. */
export function buildMatchedLogsUrl(c: MatchedLogsCriteria): string {
  const end = toTime(c.triggeredAt) ?? Date.now();
  const start = end - Math.max(1, c.windowMinutes) * 60_000;
  const url = writeScopeToUrl(new URL('http://x/dashboard/logs'), {
    projectIds: c.projectId ? [c.projectId] : [],
    range: { kind: 'custom', from: new Date(start).toISOString(), to: new Date(end).toISOString() },
  });
  const { q } = composeAlertQuery(c);
  if (q) url.searchParams.set('q', q);
  return `/dashboard/logs?${url.searchParams.toString()}`;
}

// ---------------------------------------------------------------------------
// Create / edit URL contract
// ---------------------------------------------------------------------------

export interface AlertPrefillResult {
  open: boolean;
  prefill?: AlertBuilderPrefill;
  editRuleId?: string;
}

const PREFILL_PARAMS = ['create', 'new', 'projectId', 'query', 'levels', 'service', 'name', 'edit'];

export function parseAlertPrefill(url: URL): AlertPrefillResult {
  const p = url.searchParams;
  const editRuleId = p.get('edit')?.trim() || undefined;
  const open = p.get('create') === '1' || p.get('new') === '1';

  if (!open) return editRuleId ? { open: false, editRuleId } : { open: false };

  const prefill: AlertBuilderPrefill = {};
  const projectId = p.get('projectId')?.trim();
  if (projectId) prefill.projectId = projectId;
  const query = p.get('query');
  if (query && query.trim()) prefill.query = query.trim();
  const levelsRaw = p.get('levels');
  if (levelsRaw) {
    const levels = levelsRaw
      .split(',')
      .map((l) => l.trim().toLowerCase())
      .filter((l): l is (typeof VALID_LEVELS)[number] =>
        (VALID_LEVELS as readonly string[]).includes(l)
      );
    if (levels.length > 0) prefill.levels = [...new Set(levels)];
  }
  const service = p.get('service')?.trim();
  if (service) prefill.service = service;
  const name = p.get('name')?.trim();
  if (name) prefill.name = name;

  return editRuleId ? { open: true, prefill, editRuleId } : { open: true, prefill };
}

/** Path plus the query string left after dropping the prefill/edit params. */
export function stripPrefillParams(url: URL): string {
  const next = new URL(url.href);
  for (const key of PREFILL_PARAMS) next.searchParams.delete(key);
  const search = next.searchParams.toString();
  return `${next.pathname}${search ? `?${search}` : ''}${next.hash}`;
}
