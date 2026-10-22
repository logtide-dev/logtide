// ============================================================================
// ClickHouse free-text terms (plan S1 to S3)
// ============================================================================
// Word: every token of the value must appear in `message` as a whole token
// (bounded by start/end of text or a character outside [\p{L}\p{N}_]),
// case-insensitively, no stemming. A `lowerUTF8(message) LIKE` prefilter
// (served by the lowercase ngram index) narrows the rows the RE2 boundary
// regex has to check. Phrase: case-insensitive substring through the same
// LIKE, with LIKE metacharacters escaped. `hasToken` is not used: its
// separators (every non-alphanumeric ASCII byte, `_` included) differ from
// the contract. The client escapes backslashes in String parameters, so the
// patterns reach the server literally.

import { tokenizeWords } from '@logtide/shared';
import { legacySearchToTextQuery } from '../../core/text-query.js';
import type { SearchMode, TextQuery } from '../../core/types.js';

type TextTerm = TextQuery['all'][number];

/** A character outside the word class of S2 (RE2 syntax, UTF-8 aware). */
const NON_WORD = '[^\\p{L}\\p{N}_]';

/** Greek sigma forms: lowerUTF8 maps capital sigma to medial sigma only. */
const SIGMA = /[\u03c2\u03c3]/g;

/**
 * S1: `textQuery` wins; otherwise the legacy `search`/`searchMode` pair is
 * converted the way the client does it (substring: one phrase; fulltext: the
 * AND of its words). Undefined when there is nothing to match.
 */
export function resolveTextQuery(params: {
  textQuery?: TextQuery;
  search?: string;
  searchMode?: SearchMode;
}): TextQuery | undefined {
  if (params.textQuery !== undefined) return params.textQuery;
  return legacySearchToTextQuery(params.search, params.searchMode);
}

/** Escapes the LIKE metacharacters `\`, `%` and `_`. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Escapes the RE2 metacharacters `\ ^ $ . | ? * + ( ) [ ] { }`. */
export function escapeRe2(s: string): string {
  return s.replace(/[\\^$.|?*+()[\]{}]/g, (c) => `\\${c}`);
}

/**
 * Lowercases one code point at a time, keeping a character whose lowercase
 * form changes its code point count or UTF-8 length: that is what
 * ClickHouse `lowerUTF8` does, so the pattern folds like the column.
 * (A whole-string toLowerCase would also apply context rules such as the
 * Greek final sigma, which lowerUTF8 does not.)
 */
export function lowerLikeClickHouse(s: string): string {
  let out = '';
  for (const ch of s) {
    const lower = ch.toLowerCase();
    const sameShape = lower.length === ch.length && [...lower].length === 1 && Buffer.byteLength(lower) === Buffer.byteLength(ch);
    out += sameShape ? lower : ch;
  }
  return out;
}

/** The `lowerUTF8(message) LIKE` pattern of a phrase. */
export function phraseLikePattern(value: string): string {
  return `%${escapeLike(lowerLikeClickHouse(value))}%`;
}

/**
 * The prefilter pattern of a word token. Sigma forms become `_` (any one
 * character) so the prefilter never drops a row the case-insensitive regex
 * would accept; the regex does the exact check.
 */
export function wordLikePattern(token: string): string {
  return `%${escapeLike(lowerLikeClickHouse(token)).replace(SIGMA, '_')}%`;
}

/** The RE2 pattern matching `token` as a whole token, case-insensitively. */
export function wordRegex(token: string): string {
  return `(?i)(^|${NON_WORD})${escapeRe2(token)}($|${NON_WORD})`;
}

/**
 * Compiles a text query into WHERE predicates (ANDed by the caller) and
 * writes their parameters (`p_tq0`, `p_tq1`, ...) into `queryParams`.
 * Empty terms are ignored; a group with no usable term adds nothing.
 */
export function compileTextQuery(text: TextQuery, queryParams: Record<string, unknown>): string[] {
  let next = 0;
  const param = (value: string): string => {
    let name = `p_tq${next++}`;
    while (Object.prototype.hasOwnProperty.call(queryParams, name)) name = `p_tq${next++}`;
    queryParams[name] = value;
    return `{${name}:String}`;
  };

  const phrase = (value: string): string => `lowerUTF8(message) LIKE ${param(phraseLikePattern(value))}`;
  const token = (value: string): string =>
    `(lowerUTF8(message) LIKE ${param(wordLikePattern(value))} AND match(message, ${param(wordRegex(value))}))`;

  const term = (t: TextTerm): string | null => {
    if (t.value.trim() === '') return null;
    if (t.kind === 'phrase') return phrase(t.value);
    const tokens = tokenizeWords(t.value);
    if (tokens.length === 0) return phrase(t.value);
    const parts = tokens.map(token);
    return parts.length === 1 ? parts[0] : `(${parts.join(' AND ')})`;
  };

  const conditions: string[] = [];
  for (const t of text.all) {
    const sql = term(t);
    if (sql !== null) conditions.push(sql);
  }
  for (const group of text.anyOf) {
    const parts = group.map(term).filter((s): s is string => s !== null);
    if (parts.length === 0) continue;
    conditions.push(parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`);
  }
  for (const t of text.none) {
    const sql = term(t);
    if (sql !== null) conditions.push(`NOT (${sql})`);
  }
  return conditions;
}
