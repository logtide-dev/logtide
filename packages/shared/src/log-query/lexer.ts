// ============================================================================
// Log query lexer (internal; shared by the parser and the query editors)
// ============================================================================
// One left-to-right scan with UTF-16 positions. It decides field clause
// versus free text (spec 5.3 colon rule), reads quoted strings and value
// lists, and reports lexical errors. Semantics (operators per field, limits)
// belong to the parser.

import { LOG_LEVELS } from '../constants/log-constants.js';
import { isFieldKeySyntax } from './keys.js';
import { LOG_QUERY_LIMITS } from './types.js';

export type LexListValue = { text: string; quoted: boolean; start: number; end: number };

export type LexValue =
  | { kind: 'bare' | 'quoted'; text: string; start: number }
  | { kind: 'list'; open: number; values: LexListValue[] };

export type LexItem =
  | { type: 'text'; start: number; end: number; negated: boolean; quoted: boolean; value: string }
  | { type: 'field'; start: number; end: number; negated: boolean; key: string; value: LexValue }
  | { type: 'or' | 'and'; start: number; end: number }
  | { type: 'error'; start: number; end: number };

export interface LexResult {
  items: LexItem[];
  /** The first error by position, if any. */
  error?: { message: string; position: number };
  /** True when a quote or parenthesis is left open; editors then leave the input alone. */
  structural: boolean;
}

const fmt = (n: number): string => n.toLocaleString('en-US');

const LEVEL_LIST = `${LOG_LEVELS.slice(0, -1).join(', ')} or ${LOG_LEVELS[LOG_LEVELS.length - 1]}`;

/** Every user-facing parse error (plan D2). Sentence case, no trailing period. */
export const LOG_QUERY_MESSAGES = {
  UNCLOSED_QUOTE: 'Unclosed quote',
  UNCLOSED_PAREN: 'Unclosed parenthesis',
  STRAY_PAREN:
    'Parentheses are only supported in field lists like key:(a OR b); put text in quotes to search for it',
  OR_SIDES: 'OR needs a term on both sides',
  AND_SIDES: 'AND needs a term on both sides',
  OR_MIXED: 'OR can only join free-text terms, or values of the same field; use key:(a OR b)',
  OR_NEGATED: 'OR cannot join excluded terms',
  LIST_SEPARATOR: 'Separate values with OR, like key:(a OR b)',
  EMPTY_LIST: 'Empty value list',
  BUILTIN_OP: (key: string): string =>
    `The ${key} field supports only ${key}:value, -${key}:value and ${key}:(a OR b)`,
  BUILTIN_EQ_ONLY: (key: string): string => `The ${key} field supports only ${key}:value`,
  DUPLICATE_BUILTIN: (key: string): string => `The ${key} field is already filtered (use ${key}:(a OR b))`,
  UNKNOWN_LEVEL: (value: string): string => `Unknown level "${value}" (use ${LEVEL_LIST})`,
  NEGATED_CONTAINS: 'Excluding a *text* match is not supported',
  TOO_LONG: `Query is too long (max ${fmt(LOG_QUERY_LIMITS.maxQueryLength)} characters)`,
  TOO_MANY_FIELDS: `Too many field filters (max ${fmt(LOG_QUERY_LIMITS.maxMetadataClauses)})`,
  TOO_MANY_VALUES: `Too many values in a list (max ${fmt(LOG_QUERY_LIMITS.maxListValues)})`,
  VALUE_TOO_LONG: `Value is too long (max ${fmt(LOG_QUERY_LIMITS.maxValueLength)} characters)`,
  KEY_TOO_LONG: `Field name is too long (max ${fmt(LOG_QUERY_LIMITS.maxKeyLength)} characters)`,
} as const;

const WHITESPACE = /\s/u;
const HEX_DIGIT = /^[0-9A-Fa-f]$/;
const IPV4_PART = /^\d{1,3}$/;

function isWs(ch: string): boolean {
  return WHITESPACE.test(ch);
}

/** Reads `"..."` starting at the opening quote; `\"` and `\\` are escapes, any other backslash is literal. */
function readQuoted(input: string, quote: number): { text: string; end: number } | null {
  let out = '';
  let k = quote + 1;
  while (k < input.length) {
    const c = input[k];
    if (c === '\\' && (input[k + 1] === '"' || input[k + 1] === '\\')) {
      out += input[k + 1];
      k += 2;
      continue;
    }
    if (c === '"') return { text: out, end: k + 1 };
    out += c;
    k++;
  }
  return null;
}

/**
 * IPv6 or MAC shape: only hex digits and `:` with at least two colons,
 * optionally ending in a dotted IPv4 tail or a `%zone`.
 */
function isAddressShape(token: string): boolean {
  let body = token;
  const pct = body.indexOf('%');
  if (pct >= 0) {
    if (pct === body.length - 1) return false;
    body = body.slice(0, pct);
  }
  let head = body;
  if (body.includes('.')) {
    const lastColon = body.lastIndexOf(':');
    if (lastColon < 0) return false;
    const parts = body.slice(lastColon + 1).split('.');
    if (parts.length !== 4 || !parts.every((p) => IPV4_PART.test(p))) return false;
    head = body.slice(0, lastColon + 1);
  }
  let colons = 0;
  for (const ch of head) {
    if (ch === ':') colons++;
    else if (!HEX_DIGIT.test(ch)) return false;
  }
  return colons >= 2;
}

function firstParen(text: string): number {
  for (let k = 0; k < text.length; k++) {
    if (text[k] === '(' || text[k] === ')') return k;
  }
  return -1;
}

type ListRead = {
  values: LexListValue[];
  end: number;
  error?: { message: string; position: number };
  structural: boolean;
};

/** Reads `( v OR "w" ... )` starting at the `(`. Inner errors keep scanning to the closing parenthesis. */
function readList(input: string, open: number): ListRead {
  const len = input.length;
  const values: LexListValue[] = [];
  let error: { message: string; position: number } | undefined;
  const note = (message: string, position: number): void => {
    if (!error) error = { message, position };
  };
  const unclosed = (): ListRead => ({
    values,
    end: len,
    error: { message: LOG_QUERY_MESSAGES.UNCLOSED_PAREN, position: open },
    structural: true,
  });
  let prev: 'none' | 'value' | 'or' = 'none';
  let lastOr = -1;
  let depth = 0;
  let k = open + 1;
  const addValue = (text: string, quoted: boolean, start: number, end: number): void => {
    if (prev === 'value') note(LOG_QUERY_MESSAGES.LIST_SEPARATOR, start);
    values.push({ text, quoted, start, end });
    prev = 'value';
  };
  for (;;) {
    while (k < len && isWs(input[k])) k++;
    if (k >= len) return unclosed();
    const c = input[k];
    if (c === ')') {
      if (depth > 0) {
        depth--;
        k++;
        continue;
      }
      if (prev === 'or') note(LOG_QUERY_MESSAGES.OR_SIDES, lastOr);
      else if (prev === 'none') note(LOG_QUERY_MESSAGES.EMPTY_LIST, open);
      return { values, end: k + 1, error, structural: false };
    }
    if (c === '(') {
      note(LOG_QUERY_MESSAGES.STRAY_PAREN, k);
      depth++;
      k++;
      continue;
    }
    if (c === '"') {
      const q = readQuoted(input, k);
      if (!q) return unclosed();
      addValue(q.text, true, k, q.end);
      k = q.end;
      continue;
    }
    let e = k;
    while (e < len && !isWs(input[e]) && input[e] !== '(' && input[e] !== ')') e++;
    const text = input.slice(k, e);
    if (text === 'OR') {
      if (prev !== 'value') note(LOG_QUERY_MESSAGES.OR_SIDES, prev === 'or' ? lastOr : k);
      prev = 'or';
      lastOr = k;
    } else if (text === 'AND') {
      note(LOG_QUERY_MESSAGES.LIST_SEPARATOR, k);
      prev = 'value';
    } else {
      addValue(text, false, k, e);
    }
    k = e;
  }
}

export function lexLogQuery(input: string): LexResult {
  const len = input.length;
  if (len > LOG_QUERY_LIMITS.maxQueryLength) {
    let first = 0;
    while (first < len && isWs(input[first])) first++;
    let last = len;
    while (last > first && isWs(input[last - 1])) last--;
    return {
      items: first < last ? [{ type: 'error', start: first, end: last }] : [],
      error: { message: LOG_QUERY_MESSAGES.TOO_LONG, position: LOG_QUERY_LIMITS.maxQueryLength },
      structural: false,
    };
  }

  const items: LexItem[] = [];
  let error: { message: string; position: number } | undefined;
  let structural = false;
  const fail = (message: string, position: number, isStructural = false): void => {
    if (!error || position < error.position) error = { message, position };
    if (isStructural) structural = true;
  };

  let i = 0;
  while (i < len) {
    if (isWs(input[i])) {
      i++;
      continue;
    }
    const start = i;
    let j = i;
    let negated = false;
    if (input[j] === '-' && j + 1 < len && !isWs(input[j + 1]) && input[j + 1] !== '-') {
      negated = true;
      j++;
    }

    // Clause-initial quote: a phrase that ends at its closing quote.
    if (input[j] === '"') {
      const q = readQuoted(input, j);
      if (!q) {
        fail(LOG_QUERY_MESSAGES.UNCLOSED_QUOTE, j, true);
        items.push({ type: 'error', start, end: len });
        i = len;
        continue;
      }
      items.push({ type: 'text', start, end: q.end, negated, quoted: true, value: q.text });
      i = q.end;
      continue;
    }

    let runEnd = j;
    while (runEnd < len && !isWs(input[runEnd])) runEnd++;
    const run = input.slice(j, runEnd);

    if (!negated && (run === 'OR' || run === 'AND')) {
      items.push({ type: run === 'OR' ? 'or' : 'and', start, end: runEnd });
      i = runEnd;
      continue;
    }

    // Field clause: valid key, a non-empty value not starting with `//`, not an address.
    const colon = run.indexOf(':');
    if (colon > 0 && isFieldKeySyntax(run.slice(0, colon)) && !isAddressShape(run)) {
      const key = run.slice(0, colon);
      const vs = j + colon + 1;
      if (vs < runEnd && !input.startsWith('//', vs)) {
        if (input[vs] === '(') {
          const list = readList(input, vs);
          if (list.error) {
            fail(list.error.message, list.error.position, list.structural);
            items.push({ type: 'error', start, end: list.end });
          } else {
            items.push({
              type: 'field',
              start,
              end: list.end,
              negated,
              key,
              value: { kind: 'list', open: vs, values: list.values },
            });
          }
          i = list.end;
          continue;
        }
        if (input[vs] === '"') {
          const q = readQuoted(input, vs);
          if (!q) {
            fail(LOG_QUERY_MESSAGES.UNCLOSED_QUOTE, vs, true);
            items.push({ type: 'error', start, end: len });
            i = len;
            continue;
          }
          items.push({
            type: 'field',
            start,
            end: q.end,
            negated,
            key,
            value: { kind: 'quoted', text: q.text, start: vs },
          });
          i = q.end;
          continue;
        }
        const text = input.slice(vs, runEnd);
        const paren = firstParen(text);
        if (paren >= 0) {
          fail(LOG_QUERY_MESSAGES.STRAY_PAREN, vs + paren);
          items.push({ type: 'error', start, end: runEnd });
        } else {
          items.push({ type: 'field', start, end: runEnd, negated, key, value: { kind: 'bare', text, start: vs } });
        }
        i = runEnd;
        continue;
      }
    }

    // Free text, taken literally.
    const paren = firstParen(run);
    if (paren >= 0) {
      fail(LOG_QUERY_MESSAGES.STRAY_PAREN, j + paren);
      items.push({ type: 'error', start, end: runEnd });
    } else {
      items.push({ type: 'text', start, end: runEnd, negated, quoted: false, value: run });
    }
    i = runEnd;
  }

  return error ? { items, error, structural } : { items, structural };
}
