// ============================================================================
// Click-to-filter query edits (spec 6.3)
// ============================================================================
// addFieldClause and removeFieldClause rewrite the query on lexed items, so
// text outside the touched clauses is preserved byte for byte. Input with an
// open quote or parenthesis comes back unchanged: the user is still typing.

import { resolveFieldKey } from './keys.js';
import { lexLogQuery, type LexItem, type LexListValue } from './lexer.js';
import { shapeOf } from './parser.js';
import type { FieldRef } from './types.js';

type FieldItem = Extract<LexItem, { type: 'field' }>;

/** Removal (null) or replacement text, per lexed item index. */
type Edits = Map<number, string | null>;

const BARE_VALUE = /^[^\s"()\\:]+$/u;
const ENDS_WITH_SPACE = /\s$/u;

function quoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The single value-quoting helper for clause text. A value stays bare only
 * when the grammar reads it back as the same literal: no whitespace, quote,
 * parenthesis, backslash or colon, no leading or trailing `*`, no leading
 * `//`. Anything else is quoted with `\\` and `\"` escapes, so `*` comes
 * back as `"*"` and is never read as the exists clause.
 */
export function quoteFieldValue(value: string): string {
  if (BARE_VALUE.test(value) && !value.startsWith('*') && !value.endsWith('*') && !value.startsWith('//')) {
    return value;
  }
  return quoted(value);
}

function sameField(a: FieldRef, b: FieldRef): boolean {
  if ('builtin' in a) return 'builtin' in b && a.builtin === b.builtin;
  return 'metadata' in b && a.metadata === b.metadata;
}

function isFieldOf(item: LexItem, target: FieldRef): item is FieldItem {
  if (item.type !== 'field') return false;
  const ref = resolveFieldKey(item.key);
  return ref !== null && sameField(ref, target);
}

/** Level values compare case-insensitively (the parser lowercases them), others exactly. */
function valueEquality(target: FieldRef): (a: string, b: string) => boolean {
  if ('builtin' in target && target.builtin === 'level') return (a, b) => a.toLowerCase() === b.toLowerCase();
  return (a, b) => a === b;
}

/**
 * Text of a list clause after dropping `value`; null when no value is left.
 * A single remaining value becomes `key:v` (quoted when needed, so `*`,
 * `*x*` and `//x` keep their literal meaning).
 */
function listWithout(
  input: string,
  items: LexItem[],
  k: number,
  value: string,
  eq: (a: string, b: string) => boolean,
): string | null {
  const item = items[k] as FieldItem;
  if (item.value.kind !== 'list') return null;
  const keep: LexListValue[] = item.value.values.filter((v) => !eq(v.text, value));
  if (keep.length === 0) return null;
  const head = `${item.negated ? '-' : ''}${item.key}:`;
  if (keep.length === 1) {
    const v = keep[0];
    if (v.quoted) return head + input.slice(v.start, v.end);
    // Glued to the next clause (`env:(a OR b)x`): quote so the value cannot absorb it.
    const glued = k + 1 < items.length && items[k + 1].start === item.end;
    return head + (glued ? quoted(v.text) : quoteFieldValue(v.text));
  }
  return `${head}(${keep.map((v) => input.slice(v.start, v.end)).join(' OR ')})`;
}

function isOperator(item: LexItem | undefined): boolean {
  return item !== undefined && (item.type === 'or' || item.type === 'and');
}

/**
 * Applies removals and replacements. A removed clause takes an adjacent
 * OR/AND with it (the one on its right when there is one) and one adjacent
 * whitespace run: the run before it, unless that would glue its neighbours
 * together.
 */
function applyEdits(input: string, items: LexItem[], edits: Edits): string {
  const n = items.length;
  const removed = new Set<number>();
  for (const [k, text] of edits) if (text === null) removed.add(k);
  for (const k of [...removed].sort((a, b) => a - b)) {
    if (isOperator(items[k + 1]) && !removed.has(k + 1)) removed.add(k + 1);
    else if (isOperator(items[k - 1]) && !removed.has(k - 1)) removed.add(k - 1);
  }

  // gap(k) is the whitespace before item k; gap(n) is the trailing whitespace.
  const gap = (k: number): string =>
    input.slice(k === 0 ? 0 : items[k - 1].end, k === n ? input.length : items[k].start);
  const text = (k: number): string => edits.get(k) ?? input.slice(items[k].start, items[k].end);

  const kept: number[] = [];
  for (let k = 0; k < n; k++) if (!removed.has(k)) kept.push(k);
  if (kept.length === 0) return gap(0) + gap(n);

  let out = gap(0);
  kept.forEach((k, j) => {
    if (j > 0) {
      const prev = kept[j - 1];
      if (k === prev + 1) {
        out += gap(k);
      } else {
        const after = gap(k);
        out += after !== '' ? after : gap(prev + 1);
      }
    }
    out += text(k);
  });
  return out + gap(n);
}

/**
 * Adds `key:value` (or `-key:value`) for click-to-filter.
 *
 * Positive: drops the field's other positive equals and in clauses and the
 * exclusion of the same value (also from a negated list). Negated: drops the
 * positive equals clause with that value and the value from a positive list;
 * when that narrowing leaves a positive filter of the field, the value is
 * already excluded and nothing is appended. An identical (or, for an
 * exclusion, already excluding) clause means no append. The new clause is
 * appended with one space and uses `key` as passed.
 *
 * Returns `input` unchanged for an invalid key, an open quote or parenthesis,
 * or a trailing OR/AND the user is still completing.
 */
export function addFieldClause(input: string, key: string, value: string, negate: boolean): string {
  const target = resolveFieldKey(key);
  if (!target) return input;
  const lex = lexLogQuery(input);
  if (lex.structural) return input;
  const items = lex.items;
  if (isOperator(items[items.length - 1])) return input;

  const eq = valueEquality(target);
  const edits: Edits = new Map();
  let identical = false;
  let narrowedPositive = false;
  let positiveRemains = false;

  items.forEach((item, k) => {
    if (!isFieldOf(item, target)) return;
    const { op, values } = shapeOf(item);
    const hasValue = values.some((v) => eq(v, value));
    if (!negate) {
      if (op === 'equals' && hasValue && !identical) identical = true;
      else if (op === 'equals' || op === 'in') edits.set(k, null);
      else if (op === 'not_equals' && hasValue) edits.set(k, null);
      else if (op === 'not_in' && hasValue) edits.set(k, listWithout(input, items, k, value, eq));
      return;
    }
    if ((op === 'not_equals' || op === 'not_in') && hasValue) {
      identical = true;
    } else if (op === 'equals' || op === 'in') {
      if (!hasValue) {
        positiveRemains = true;
        return;
      }
      narrowedPositive = true;
      const next = op === 'in' ? listWithout(input, items, k, value, eq) : null;
      edits.set(k, next);
      if (next !== null) positiveRemains = true;
    }
  });

  const out = edits.size > 0 ? applyEdits(input, items, edits) : input;
  if (identical || (negate && narrowedPositive && positiveRemains)) return out;
  const clause = `${negate ? '-' : ''}${key}:${quoteFieldValue(value)}`;
  return out === '' || ENDS_WITH_SPACE.test(out) ? out + clause : `${out} ${clause}`;
}

/**
 * Removes clauses of `key` (aliases included, so `host` also removes
 * `hostname:` clauses). Without `value`, every clause of the field goes
 * (positive, negated, lists, exists, contains, repeated). With `value`, only
 * equals clauses with that literal value go, and the value is dropped from
 * in-lists (a one-value list becomes `key:v`, an empty one disappears).
 *
 * Returns `input` unchanged for an invalid key or an open quote or parenthesis.
 */
export function removeFieldClause(input: string, key: string, value?: string): string {
  const target = resolveFieldKey(key);
  if (!target) return input;
  const lex = lexLogQuery(input);
  if (lex.structural) return input;
  const items = lex.items;
  const eq = valueEquality(target);
  const edits: Edits = new Map();

  items.forEach((item, k) => {
    if (!isFieldOf(item, target)) return;
    if (value === undefined) {
      edits.set(k, null);
      return;
    }
    const { op, values } = shapeOf(item);
    if ((op === 'equals' || op === 'not_equals') && eq(values[0], value)) edits.set(k, null);
    else if ((op === 'in' || op === 'not_in') && values.some((v) => eq(v, value))) {
      edits.set(k, listWithout(input, items, k, value, eq));
    }
  });

  return edits.size > 0 ? applyEdits(input, items, edits) : input;
}
