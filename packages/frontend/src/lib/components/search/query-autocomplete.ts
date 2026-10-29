// Query bar autocomplete (spec 5.4): field names from the built-ins plus the
// discovered metadata keys, values from the facets. Pure functions over the
// input text and the caret, so the component only wires keys and rendering.

import { BUILTIN_FIELD_KEYS, LOG_LEVELS, resolveFieldKey } from '@logtide/shared';
import { BUILTIN_QUERY_KEYS, isQueryableKey, quoteListValue, quoteQueryValue } from './query-edit';

export type CompletionContext =
  | { kind: 'field'; prefix: string; start: number; end: number }
  | { kind: 'value'; key: string; prefix: string; start: number; end: number; inList: boolean }
  | { kind: 'none' };

/** `insert` replaces `[start, end)` of the input; a field insert ends with `:`. */
export interface Suggestion {
  kind: 'field' | 'value';
  label: string;
  insert: string;
}

const DEFAULT_LIMIT = 8;
const NONE: CompletionContext = { kind: 'none' };
// Field key syntax of the grammar (F3 lexer): ASCII only.
const KEY_SYNTAX = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const KEY_BEFORE_COLON = /(?:^|[\s(])-?([A-Za-z_][A-Za-z0-9_.-]*):$/;
const LIST_VALUE_POSITION = /(?:^|\s)OR\s+$/;

interface Scan {
  inQuote: boolean;
  quoteStart: number;
  /** Index after the last whitespace or parenthesis outside quotes. */
  boundary: number;
  /** Index of the unclosed `(` outside quotes, or -1. */
  openParen: number;
}

function scan(before: string): Scan {
  const out: Scan = { inQuote: false, quoteStart: -1, boundary: 0, openParen: -1 };
  for (let i = 0; i < before.length; i++) {
    const ch = before[i];
    if (out.inQuote) {
      if (ch === '\\') i++;
      else if (ch === '"') out.inQuote = false;
      continue;
    }
    if (ch === '"') {
      out.inQuote = true;
      out.quoteStart = i;
    } else if (/\s/.test(ch)) {
      out.boundary = i + 1;
    } else if (ch === '(') {
      out.boundary = i + 1;
      out.openParen = i;
    } else if (ch === ')') {
      out.boundary = i + 1;
      out.openParen = -1;
    }
  }
  return out;
}

function unescapeQuoted(text: string): string {
  return text.replace(/\\(.)/g, '$1');
}

/** End of the token under the caret: stops at whitespace, parentheses, quotes (and `:` for keys). */
function tokenEnd(input: string, caret: number, stopAtColon: boolean): number {
  let i = caret;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch) || ch === '(' || ch === ')' || ch === '"' || (stopAtColon && ch === ':')) break;
    i++;
  }
  return i;
}

/** After a quote opened at `caret - n`: the closing quote, when one follows. */
function closingQuoteEnd(input: string, caret: number): number {
  for (let i = caret; i < input.length; i++) {
    if (input[i] === '\\') {
      i++;
      continue;
    }
    if (input[i] === '"') return i + 1;
  }
  return caret;
}

/** Key of the list `key:(` opened at `openParen`, when the caret sits where a list value goes. */
function listKey(before: string, openParen: number, boundary: number): string | null {
  const m = KEY_BEFORE_COLON.exec(before.slice(0, openParen));
  if (!m) return null;
  const segment = before.slice(openParen + 1, boundary);
  const atValue = segment.trim() === '' || LIST_VALUE_POSITION.test(segment);
  return atValue ? m[1] : null;
}

export function getCompletionContext(input: string, caret: number): CompletionContext {
  const at = Math.min(Math.max(0, caret), input.length);
  const before = input.slice(0, at);
  const s = scan(before);

  if (s.inQuote) {
    const prefix = unescapeQuoted(before.slice(s.quoteStart + 1));
    const end = closingQuoteEnd(input, at);
    if (s.openParen >= 0 && s.openParen < s.quoteStart) {
      const key = s.boundary === s.quoteStart ? listKey(before, s.openParen, s.boundary) : null;
      return key ? { kind: 'value', key, prefix, start: s.quoteStart, end, inList: true } : NONE;
    }
    // A quote right after `key:` opens a value; any other open quote is a free-text phrase.
    const m = KEY_BEFORE_COLON.exec(before.slice(0, s.quoteStart));
    if (!m) return NONE;
    return { kind: 'value', key: m[1], prefix, start: s.quoteStart, end, inList: false };
  }

  const token = before.slice(s.boundary);
  if (token.includes('"')) return NONE;

  if (s.openParen >= 0) {
    if (token.includes(':')) return NONE;
    const key = listKey(before, s.openParen, s.boundary);
    if (!key) return NONE;
    return { kind: 'value', key, prefix: token, start: s.boundary, end: tokenEnd(input, at, false), inList: true };
  }

  if (token === '') return NONE;
  const offset = token.startsWith('-') ? 1 : 0;
  const body = token.slice(offset);
  const colon = body.indexOf(':');

  if (colon >= 0) {
    const key = body.slice(0, colon);
    const prefix = body.slice(colon + 1);
    // `10:42` or `http://x` stay free text (spec 5.3 colon rule).
    if (!KEY_SYNTAX.test(key) || prefix.startsWith('//')) return NONE;
    return {
      kind: 'value',
      key,
      prefix,
      start: s.boundary + offset + colon + 1,
      end: tokenEnd(input, at, false),
      inList: false,
    };
  }

  if (!KEY_SYNTAX.test(body)) return NONE;
  return { kind: 'field', prefix: body, start: s.boundary + offset, end: tokenEnd(input, at, true) };
}

/** Grammar key a typed key stands for: `hostname` -> `host`; metadata keys as typed. */
function canonicalKey(key: string): string {
  const ref = resolveFieldKey(key);
  return ref && 'builtin' in ref ? BUILTIN_FIELD_KEYS[ref.builtin] : key;
}

function startsWithIgnoreCase(text: string, prefix: string): boolean {
  return text.toLowerCase().startsWith(prefix.toLowerCase());
}

export function suggest(
  ctx: CompletionContext,
  sources: { fields: string[]; valuesFor: (key: string) => string[] },
  limit: number = DEFAULT_LIMIT,
): Suggestion[] {
  if (ctx.kind === 'none') return [];
  const out: Suggestion[] = [];
  const seen = new Set<string>();

  if (ctx.kind === 'field') {
    const discovered = sources.fields.filter((k) => {
      const ref = isQueryableKey(k) ? resolveFieldKey(k) : null;
      return ref !== null && !('builtin' in ref);
    });
    for (const key of [...BUILTIN_QUERY_KEYS, ...discovered]) {
      if (out.length >= limit) break;
      if (seen.has(key) || !startsWithIgnoreCase(key, ctx.prefix)) continue;
      seen.add(key);
      out.push({ kind: 'field', label: key, insert: `${key}:` });
    }
    return out;
  }

  const key = canonicalKey(ctx.key);
  const values = key === 'level' ? [...LOG_LEVELS] : sources.valuesFor(key);
  for (const value of values) {
    if (out.length >= limit) break;
    if (seen.has(value) || !startsWithIgnoreCase(value, ctx.prefix)) continue;
    seen.add(value);
    out.push({ kind: 'value', label: value, insert: ctx.inList ? quoteListValue(value) : quoteQueryValue(value) });
  }
  return out;
}

/** Replaces the context range with the suggestion; a completed value gets one trailing space. */
export function applySuggestion(
  input: string,
  ctx: Exclude<CompletionContext, { kind: 'none' }>,
  s: Suggestion,
): { value: string; caret: number } {
  const lead = input.slice(0, ctx.start);
  const rest = input.slice(ctx.end);

  if (s.kind === 'field') {
    // Completing the key of an existing `key:value` keeps its colon.
    if (rest.startsWith(':') && s.insert.endsWith(':')) {
      const head = lead + s.insert.slice(0, -1);
      return { value: head + rest, caret: head.length + 1 };
    }
    const head = lead + s.insert;
    return { value: head + rest, caret: head.length };
  }

  const head = lead + s.insert;
  if (ctx.kind === 'value' && ctx.inList) return { value: head + rest, caret: head.length };
  if (/^\s/.test(rest)) return { value: head + rest, caret: head.length + 1 };
  return { value: `${head} ${rest}`, caret: head.length + 1 };
}
