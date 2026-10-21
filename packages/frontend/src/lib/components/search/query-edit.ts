// Clause editing on the explorer query string (spec 5.3 grammar, F3 parser).
//
// Every click-to-filter action (facets, chips, details, legacy deep links)
// edits `q` through these helpers, so the URL, saved searches, export, live
// tail and alert pre-fill all carry the same query. Values are quoted only
// through F3's `quoteFieldValue`; nothing here hand-escapes quotes.

import {
  BUILTIN_FIELD_KEYS,
  parseLogQuery,
  quoteFieldValue,
  removeFieldClause,
  resolveFieldKey,
  type FieldClause,
} from '@logtide/shared';

export const BUILTIN_QUERY_KEYS = ['level', 'service', 'host', 'trace', 'session', 'span'] as const;

export const KEY_ALIASES: Record<string, string[]> = {
  host: ['hostname'],
  trace: ['trace_id'],
  session: ['session_id'],
  span: ['span_id'],
};

const QUERYABLE_KEY = /^[\p{L}\p{N}_][\p{L}\p{N}_.@-]*$/u;
// `level:` rejects unknown values, so the key probe uses a value every field accepts.
const PROBE_VALUE = 'info';

/** Grammar key of a parsed field: `hostname` -> `host`, `traceId` -> `trace`, metadata as typed. */
export function fieldKeyOf(field: FieldClause['field']): string {
  return 'builtin' in field ? BUILTIN_FIELD_KEYS[field.builtin] : field.metadata;
}

/** Canonical grammar key for a key as typed (aliases resolved), or null when the grammar rejects it. */
function canonicalKey(key: string): string | null {
  const ref = resolveFieldKey(key);
  return ref ? fieldKeyOf(ref) : null;
}

/**
 * True when `key:value` is a field clause on exactly that key. Keys the
 * grammar would read as free text (spaces, colons, `@`, non-ASCII letters,
 * a leading `-`) are refused, so callers never build a broken query.
 */
export function isQueryableKey(key: string): boolean {
  if (!QUERYABLE_KEY.test(key)) return false;
  const canonical = canonicalKey(key);
  if (canonical === null) return false;
  const res = parseLogQuery(`${key}:${PROBE_VALUE}`);
  if (!res.ok || res.query.fields.length !== 1) return false;
  const { text } = res.query;
  if (text.all.length + text.anyOf.length + text.none.length > 0) return false;
  return fieldKeyOf(res.query.fields[0].field) === canonical;
}

/** A field value as clause text: bare when safe, else quoted with `\"` escapes (`*` always quoted). */
export function quoteQueryValue(value: string): string {
  return quoteFieldValue(value);
}

/** A free-text phrase: always quoted. */
export function quotePhrase(value: string): string {
  const q = quoteFieldValue(value);
  // A bare-safe value contains no quote or backslash, so plain wrapping needs no escapes.
  return q.startsWith('"') ? q : `"${q}"`;
}

/** A value inside `key:( ... )`: `OR` and `AND` would read as operators there, so they are quoted. */
function listValue(value: string): string {
  const q = quoteFieldValue(value);
  return q === 'OR' || q === 'AND' ? `"${q}"` : q;
}

/** `key:v`, `-key:v`, `key:(a OR b)` or `-key:(a OR b)`; empty string for no values. */
export function formatFieldClause(key: string, values: string[], negate: boolean): string {
  if (values.length === 0) return '';
  const head = `${negate ? '-' : ''}${key}:`;
  if (values.length === 1) return head + quoteQueryValue(values[0]);
  return `${head}(${values.map(listValue).join(' OR ')})`;
}

/** Appends a clause with one separating space; both sides are trimmed. */
export function appendClause(q: string, clause: string): string {
  const base = q.trim();
  const add = clause.trim();
  if (!add) return base;
  return base ? `${base} ${add}` : add;
}

/** Values of `key` (aliases included): equals/in are includes, not_equals/not_in excludes. */
export function getFieldValues(q: string, key: string): { include: string[]; exclude: string[] } {
  const include: string[] = [];
  const exclude: string[] = [];
  const canonical = canonicalKey(key);
  const res = parseLogQuery(q);
  if (!res.ok || canonical === null) return { include, exclude };
  for (const clause of res.query.fields) {
    if (fieldKeyOf(clause.field) !== canonical) continue;
    switch (clause.op) {
      case 'equals':
        if (clause.value !== undefined) include.push(clause.value);
        break;
      case 'in':
        include.push(...clause.values);
        break;
      case 'not_equals':
        if (clause.value !== undefined) exclude.push(clause.value);
        break;
      case 'not_in':
        exclude.push(...clause.values);
        break;
      default:
        break;
    }
  }
  return { include, exclude };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Rewrites every clause of `key` as one include clause and one exclude
 * clause (each only when non-empty). Returns `q` unchanged when `q` does not
 * parse, the key is not queryable, or the result would not parse (for
 * example a second value on an equals-only field like `trace`).
 * Accepted edge: an `exists` or `contains` clause on the same key goes too.
 */
export function setFieldValues(q: string, key: string, include: string[], exclude: string[]): string {
  if (!parseLogQuery(q).ok || !isQueryableKey(key)) return q;
  const canonical = canonicalKey(key) ?? key;
  let next = removeFieldClause(q, key);
  next = appendClause(next, formatFieldClause(canonical, unique(include), false));
  next = appendClause(next, formatFieldClause(canonical, unique(exclude), true));
  return parseLogQuery(next).ok ? next : q;
}

/**
 * Click-to-filter toggle: adds `value` to the include (or exclude) list of
 * `key`, or removes it when it is already there, and drops it from the other
 * list. An unparseable `q` comes back unchanged.
 */
export function toggleFieldValue(q: string, key: string, value: string, mode: 'include' | 'exclude'): string {
  if (!parseLogQuery(q).ok) return q;
  const isLevel = canonicalKey(key) === 'level';
  const v = isLevel ? value.toLowerCase() : value;
  const current = getFieldValues(q, key);
  const target = mode === 'include' ? current.include : current.exclude;
  const other = mode === 'include' ? current.exclude : current.include;
  const nextTarget = target.includes(v) ? target.filter((x) => x !== v) : [...target, v];
  const nextOther = other.filter((x) => x !== v);
  return mode === 'include'
    ? setFieldValues(q, key, nextTarget, nextOther)
    : setFieldValues(q, key, nextOther, nextTarget);
}
