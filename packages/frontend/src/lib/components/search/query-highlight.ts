// Query bar syntax highlighting and message match marks (spec 5.3, 5.4).
// Everything returns plain-text segments: callers never use {@html}.

import type { LogSearchQuery, QueryToken, TextTerm } from '@logtide/shared';

export type HighlightKind = QueryToken['kind'] | 'plain';

export interface TokenSegment {
  text: string;
  kind: HighlightKind;
  start: number;
}

/** Splits `input` into token segments plus `plain` gaps, covering every character once. */
export function tokenSegments(input: string, tokens: QueryToken[]): TokenSegment[] {
  const segments: TokenSegment[] = [];
  const sorted = [...tokens].sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const token of sorted) {
    const start = Math.max(token.start, cursor);
    const end = Math.min(token.end, input.length);
    if (end <= start) continue;
    if (start > cursor) segments.push({ text: input.slice(cursor, start), kind: 'plain', start: cursor });
    segments.push({ text: input.slice(start, end), kind: token.kind, start });
    cursor = end;
  }
  if (cursor < input.length) segments.push({ text: input.slice(cursor), kind: 'plain', start: cursor });
  return segments;
}

/**
 * Range to underline for a parse error: the token around `position`, or the
 * single character there. A position at (or past) the end is clamped to the
 * last character.
 */
export function errorRange(input: string, tokens: QueryToken[], position: number): { start: number; end: number } {
  if (input.length === 0) return { start: 0, end: 0 };
  const p = Math.min(Math.max(0, position), input.length - 1);
  const around = tokens.find((t) => t.start <= p && p < t.end);
  if (around) return { start: around.start, end: Math.min(around.end, input.length) };
  return { start: p, end: p + 1 };
}

const WORD_RUN = /[\p{L}\p{N}_]+/gu;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type Range = { start: number; end: number };

function wordRanges(message: string, words: Set<string>): Range[] {
  if (words.size === 0) return [];
  const ranges: Range[] = [];
  for (const m of message.matchAll(WORD_RUN)) {
    if (m.index !== undefined && words.has(m[0].toLowerCase())) {
      ranges.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  return ranges;
}

function phraseRanges(message: string, phrase: string): Range[] {
  if (!phrase) return [];
  const ranges: Range[] = [];
  const re = new RegExp(escapeRegExp(phrase), 'giu');
  for (const m of message.matchAll(re)) {
    if (m.index !== undefined && m[0].length > 0) ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  return ranges;
}

function merge(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/**
 * Marks the parts of `message` the positive free text matches: words as
 * whole words (Unicode letters, digits, `_`; case-insensitive), phrases as
 * case-insensitive substrings. Excluded terms and field values are never marked.
 */
export function messageHighlights(message: string, query: LogSearchQuery | null): { text: string; match: boolean }[] {
  const value = message ?? '';
  if (!value || !query) return [{ text: value, match: false }];
  const terms: TextTerm[] = [...query.text.all, ...query.text.anyOf.flat()];
  const words = new Set(terms.filter((t) => t.kind === 'word').map((t) => t.value.toLowerCase()));
  const ranges = merge([
    ...wordRanges(value, words),
    ...terms.filter((t) => t.kind === 'phrase').flatMap((t) => phraseRanges(value, t.value)),
  ]);
  if (ranges.length === 0) return [{ text: value, match: false }];
  const out: { text: string; match: boolean }[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) out.push({ text: value.slice(cursor, r.start), match: false });
    out.push({ text: value.slice(r.start, r.end), match: true });
    cursor = r.end;
  }
  if (cursor < value.length) out.push({ text: value.slice(cursor), match: false });
  return out;
}
