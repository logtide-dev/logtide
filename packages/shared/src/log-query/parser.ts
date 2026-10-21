// ============================================================================
// parseLogQuery (spec 5.3 / 6.3, plan D1 and D2)
// ============================================================================

import { lexLogQuery, LOG_QUERY_MESSAGES, type LexItem } from './lexer.js';
import type { FieldClause, LogSearchQuery, ParseLogQueryResult, QueryToken, TextTerm } from './types.js';

type TextItem = Extract<LexItem, { type: 'text' }>;
type FieldItem = Extract<LexItem, { type: 'field' }>;
type TermItem = TextItem | FieldItem | Extract<LexItem, { type: 'error' }>;

interface ParseError {
  message: string;
  position: number;
}

const WORD_ONLY = /^[\p{L}\p{N}_]+$/u;

const emptyQuery = (): LogSearchQuery => ({ text: { all: [], anyOf: [], none: [] }, fields: [] });

function isOperator(item: LexItem | undefined): boolean {
  return item !== undefined && (item.type === 'or' || item.type === 'and');
}

function textTerm(item: TextItem): TextTerm | null {
  if (item.quoted) return item.value === '' ? null : { kind: 'phrase', value: item.value };
  return { kind: WORD_ONLY.test(item.value) ? 'word' : 'phrase', value: item.value };
}

function fieldClause(item: FieldItem): FieldClause {
  const field = { metadata: item.key };
  const v = item.value;
  if (v.kind === 'list') {
    return { field, op: item.negated ? 'not_in' : 'in', values: v.values.map((x) => x.text) };
  }
  if (v.kind === 'bare' && v.text === '*') return { field, op: item.negated ? 'not_exists' : 'exists' };
  return { field, op: item.negated ? 'not_equals' : 'equals', value: v.text };
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

  // Operators: both sides must be terms; OR joins positive free text only.
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
    if (l.negated || r.negated) fail(LOG_QUERY_MESSAGES.OR_NEGATED, item.start, k);
    else if (l.type === 'text' && r.type === 'text') joined.add(k);
    else fail(LOG_QUERY_MESSAGES.OR_MIXED, item.start, k);
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
    query.fields.push(fieldClause(first));
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
