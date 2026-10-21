// ============================================================================
// parseLogQuery (spec 5.3 / 6.3, plan D1 and D2)
// ============================================================================
// Lexes the input, joins OR chains (free text into any-of groups, values of
// one field into an in-list), applies the built-in operator rules and the
// metadataFilterSchema limits, and reports the first error by position.

import { LOG_LEVELS } from '../constants/log-constants.js';
import { builtinForKey } from './keys.js';
import { lexLogQuery, LOG_QUERY_MESSAGES, type LexItem } from './lexer.js';
import {
  LOG_QUERY_LIMITS,
  type BuiltinField,
  type FieldClause,
  type FieldRef,
  type LogSearchQuery,
  type ParseLogQueryResult,
  type QueryToken,
  type TextTerm,
} from './types.js';

type TextItem = Extract<LexItem, { type: 'text' }>;
type FieldItem = Extract<LexItem, { type: 'field' }>;
type TermItem = TextItem | FieldItem | Extract<LexItem, { type: 'error' }>;

interface ParseError {
  message: string;
  position: number;
}

type ShapeOp = FieldClause['op'] | 'not_contains';

const WORD_ONLY = /^[\p{L}\p{N}_]+$/u;
const EQUALS_ONLY = new Set<BuiltinField>(['traceId', 'sessionId', 'spanId']);
const BUILTIN_OPS = new Set<ShapeOp>(['equals', 'not_equals', 'in', 'not_in']);
const LEVELS = new Set<string>(LOG_LEVELS);

const emptyQuery = (): LogSearchQuery => ({ text: { all: [], anyOf: [], none: [] }, fields: [] });

function isOperator(item: LexItem | undefined): boolean {
  return item !== undefined && (item.type === 'or' || item.type === 'and');
}

function textTerm(item: TextItem): TextTerm | null {
  if (item.quoted) return item.value === '' ? null : { kind: 'phrase', value: item.value };
  return { kind: WORD_ONLY.test(item.value) ? 'word' : 'phrase', value: item.value };
}

/** Operator and raw values of one field clause as typed (before built-in rules). */
function shapeOf(item: FieldItem): { op: ShapeOp; values: string[] } {
  const v = item.value;
  if (v.kind === 'list') return { op: item.negated ? 'not_in' : 'in', values: v.values.map((x) => x.text) };
  if (v.kind === 'quoted') return { op: item.negated ? 'not_equals' : 'equals', values: [v.text] };
  if (v.text === '*') return { op: item.negated ? 'not_exists' : 'exists', values: [] };
  if (v.text.length >= 3 && v.text.startsWith('*') && v.text.endsWith('*')) {
    return { op: item.negated ? 'not_contains' : 'contains', values: [v.text.slice(1, -1)] };
  }
  return { op: item.negated ? 'not_equals' : 'equals', values: [v.text] };
}

function fieldIdentity(key: string): string {
  const builtin = builtinForKey(key);
  return builtin ? `builtin:${builtin}` : `metadata:${key}`;
}

/** Positive equals or in clauses of one field can be OR-ed into one in-list. */
function isMergeable(item: FieldItem): boolean {
  const op = shapeOf(item).op;
  return op === 'equals' || op === 'in';
}

type FieldBuild = { clause: FieldClause } | { error: ParseError; index: number };

function buildField(items: FieldItem[], indexes: number[]): FieldBuild {
  const fail = (message: string, position: number, n: number): FieldBuild => ({
    error: { message, position },
    index: indexes[n],
  });
  for (let n = 0; n < items.length; n++) {
    if (items[n].key.length > LOG_QUERY_LIMITS.maxKeyLength) return fail(LOG_QUERY_MESSAGES.KEY_TOO_LONG, items[n].start, n);
  }
  const first = items[0];
  const builtin = builtinForKey(first.key);
  const shapes = items.map(shapeOf);
  const op: ShapeOp = items.length > 1 ? 'in' : shapes[0].op;

  if (builtin) {
    if (EQUALS_ONLY.has(builtin) ? op !== 'equals' : !BUILTIN_OPS.has(op)) {
      const message = EQUALS_ONLY.has(builtin)
        ? LOG_QUERY_MESSAGES.BUILTIN_EQ_ONLY(first.key)
        : LOG_QUERY_MESSAGES.BUILTIN_OP(first.key);
      return fail(message, first.start, 0);
    }
  }
  if (op === 'not_contains') return fail(LOG_QUERY_MESSAGES.NEGATED_CONTAINS, first.start, 0);

  const values: string[] = [];
  for (let n = 0; n < items.length; n++) {
    const item = items[n];
    for (const value of shapes[n].values) {
      if (value.length > LOG_QUERY_LIMITS.maxValueLength) return fail(LOG_QUERY_MESSAGES.VALUE_TOO_LONG, item.start, n);
    }
    if (builtin === 'level') {
      const unknown = shapes[n].values.find((value) => !LEVELS.has(value.toLowerCase()));
      if (unknown !== undefined) return fail(LOG_QUERY_MESSAGES.UNKNOWN_LEVEL(unknown), item.start, n);
    }
    values.push(...(builtin === 'level' ? shapes[n].values.map((value) => value.toLowerCase()) : shapes[n].values));
    if (values.length > LOG_QUERY_LIMITS.maxListValues) {
      const position = item.value.kind === 'list' ? item.value.open : item.start;
      return fail(LOG_QUERY_MESSAGES.TOO_MANY_VALUES, position, n);
    }
  }

  const field: FieldRef = builtin ? { builtin } : { metadata: first.key };
  switch (op) {
    case 'in':
    case 'not_in':
      return { clause: { field, op, values } };
    case 'exists':
    case 'not_exists':
      return { clause: { field, op } };
    case 'equals':
    case 'not_equals':
    case 'contains':
      return { clause: { field, op, value: values[0] } };
  }
}

export function parseLogQuery(input: string): ParseLogQueryResult {
  const lex = lexLogQuery(input);
  const items = lex.items;
  const errors: ParseError[] = lex.error ? [lex.error] : [];
  const failed = new Set<number>();
  const fail = (message: string, position: number, index: number): void => {
    errors.push({ message, position });
    failed.add(index);
  };

  // Operators: both sides must be terms; OR joins positive free text, or
  // positive equals / in clauses of the same field.
  const joined = new Set<number>();
  items.forEach((item, k) => {
    if (item.type !== 'or' && item.type !== 'and') return;
    const left = items[k - 1];
    const right = items[k + 1];
    if (!left || isOperator(left) || !right || isOperator(right)) {
      fail(item.type === 'or' ? LOG_QUERY_MESSAGES.OR_SIDES : LOG_QUERY_MESSAGES.AND_SIDES, item.start, k);
      return;
    }
    if (item.type === 'and' || left.type === 'error' || right.type === 'error') return;
    const l = left as TextItem | FieldItem;
    const r = right as TextItem | FieldItem;
    if (l.negated || r.negated) {
      fail(LOG_QUERY_MESSAGES.OR_NEGATED, item.start, k);
    } else if (l.type === 'text' && r.type === 'text') {
      joined.add(k);
    } else if (
      l.type === 'field' &&
      r.type === 'field' &&
      fieldIdentity(l.key) === fieldIdentity(r.key) &&
      isMergeable(l) &&
      isMergeable(r)
    ) {
      joined.add(k);
    } else {
      fail(LOG_QUERY_MESSAGES.OR_MIXED, item.start, k);
    }
  });

  // Group terms into units: a single clause or a chain joined by OR.
  const units: { items: TermItem[]; indexes: number[] }[] = [];
  items.forEach((item, k) => {
    if (isOperator(item)) return;
    const term = item as TermItem;
    if (k >= 2 && joined.has(k - 1)) {
      const unit = units[units.length - 1];
      unit.items.push(term);
      unit.indexes.push(k);
    } else {
      units.push({ items: [term], indexes: [k] });
    }
  });

  const query = emptyQuery();
  const positiveBuiltins = new Set<BuiltinField>();
  let metadataClauses = 0;
  for (const unit of units) {
    const first = unit.items[0];
    if (first.type === 'error') continue;
    if (first.type === 'text') {
      const terms = (unit.items as TextItem[]).map(textTerm).filter((t): t is TextTerm => t !== null);
      if (unit.items.length === 1) {
        if (terms.length === 1) (first.negated ? query.text.none : query.text.all).push(terms[0]);
      } else if (terms.length >= 2) {
        query.text.anyOf.push(terms);
      } else if (terms.length === 1) {
        query.text.all.push(terms[0]);
      }
      continue;
    }

    const builtin = builtinForKey(first.key);
    if (!builtin && ++metadataClauses > LOG_QUERY_LIMITS.maxMetadataClauses) {
      fail(LOG_QUERY_MESSAGES.TOO_MANY_FIELDS, first.start, unit.indexes[0]);
      continue;
    }
    const built = buildField(unit.items as FieldItem[], unit.indexes);
    if ('error' in built) {
      fail(built.error.message, built.error.position, built.index);
      continue;
    }
    if (builtin && (built.clause.op === 'equals' || built.clause.op === 'in')) {
      if (positiveBuiltins.has(builtin)) {
        fail(LOG_QUERY_MESSAGES.DUPLICATE_BUILTIN(first.key), first.start, unit.indexes[0]);
        continue;
      }
      positiveBuiltins.add(builtin);
    }
    query.fields.push(built.clause);
  }

  const tokens = buildTokens(items, failed);
  if (errors.length > 0) {
    const error = errors.reduce((a, b) => (b.position < a.position ? b : a));
    return { ok: false, error: { message: error.message, position: error.position }, tokens };
  }
  return { ok: true, query, tokens };
}

function buildTokens(items: LexItem[], failed: Set<number>): QueryToken[] {
  const tokens: QueryToken[] = [];
  items.forEach((item, k) => {
    if (item.type === 'error' || failed.has(k)) {
      tokens.push({ kind: 'error', start: item.start, end: item.end });
      return;
    }
    if (item.type !== 'text' && item.type !== 'field') {
      tokens.push({ kind: 'operator', start: item.start, end: item.end });
      return;
    }
    let start = item.start;
    if (item.negated) {
      tokens.push({ kind: 'negation', start, end: start + 1 });
      start += 1;
    }
    if (item.type === 'field') {
      tokens.push({ kind: 'field', start, end: item.end });
    } else {
      const kind = item.quoted || !WORD_ONLY.test(item.value) ? 'phrase' : 'word';
      tokens.push({ kind, start, end: item.end });
    }
  });
  return tokens;
}

/** Legacy `searchMode=substring`: the whole input is one phrase, kept as typed. */
export function legacySubstringQuery(input: string): LogSearchQuery {
  const query = emptyQuery();
  if (input.trim() !== '') query.text.all.push({ kind: 'phrase', value: input });
  return query;
}
