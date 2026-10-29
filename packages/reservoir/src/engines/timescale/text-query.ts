// ============================================================================
// TimescaleDB free-text terms (spec 5.3, plan S1 to S3)
// ============================================================================
// Words match whole tokens of `message` case-insensitively: a word-boundary
// regex (`\m...\M`, word characters are letters, digits and `_`) served by
// the trigram index, OR'ed with the English full-text index so stemming adds
// matches (the documented Timescale difference). Phrases are ILIKE
// substrings. Every user value is a bound parameter.
//
// The full-text branch only runs for ASCII letters and digits, and only on
// messages without `_`: the default text search parser splits `user_id` into
// `user` and `id`, which would make the word `user` match `user_id` (not a
// stemming difference, so not allowed). Messages with `_` keep exact token
// matching through the regex branch.

import { tokenizeWords } from '@logtide/shared';
import { legacySearchToTextQuery } from '../../core/text-query.js';
import type { SearchMode, TextQuery } from '../../core/types.js';

type TextTerm = TextQuery['all'][number];

export interface CompiledConditions {
  conditions: string[];
  values: unknown[];
  nextIdx: number;
}

/** LIKE pattern escaping for the default `\` escape character. */
export function escapeIlike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Escapes every metacharacter of a PostgreSQL advanced regular expression. */
export function escapePgRegex(value: string): string {
  return value.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
}

const FTS_TOKEN = /^[a-z0-9]+$/;

/**
 * The text query an engine call searches for (S1): `textQuery` wins, else
 * the legacy `search`/`searchMode` conversion of the client.
 */
export function resolveTextQuery(params: {
  textQuery?: TextQuery;
  search?: string;
  searchMode?: SearchMode;
}): TextQuery | undefined {
  if (params.textQuery !== undefined) return params.textQuery;
  return legacySearchToTextQuery(params.search, params.searchMode);
}

class Binder {
  readonly values: unknown[] = [];

  constructor(private idx: number) {}

  bind(value: unknown): string {
    this.values.push(value);
    return `$${this.idx++}`;
  }

  get nextIdx(): number {
    return this.idx;
  }
}

function tokenSql(token: string, b: Binder): string {
  const regex = `message ~* ${b.bind(`\\m${escapePgRegex(token)}\\M`)}`;
  if (!FTS_TOKEN.test(token)) return regex;
  // The full-text expression must stay identical to idx_logs_fulltext.
  const fts = `to_tsvector('english', message) @@ plainto_tsquery('english', ${b.bind(token)})`;
  return `(${regex} OR (${fts} AND strpos(message, '_') = 0))`;
}

function phraseSql(value: string, b: Binder): string {
  return `message ILIKE ${b.bind(`%${escapeIlike(value)}%`)}`;
}

/** The conditions of one term; a word with several tokens gives one per token. */
function termConditions(term: TextTerm, b: Binder): string[] {
  if (term.kind === 'phrase') return [phraseSql(term.value, b)];
  const tokens = tokenizeWords(term.value);
  if (tokens.length === 0) return [phraseSql(term.value, b)];
  return tokens.map((token) => tokenSql(token, b));
}

function termExpr(term: TextTerm, b: Binder): string {
  const parts = termConditions(term, b);
  return parts.length === 1 ? parts[0] : `(${parts.join(' AND ')})`;
}

const isBlank = (term: TextTerm): boolean => term.value.trim() === '';

/**
 * WHERE conditions for a text query (S1): every term of `all`, at least one
 * term of each `anyOf` group, no term of `none`. Blank terms are ignored.
 */
export function compileTextQuery(text: TextQuery | undefined, startIdx: number): CompiledConditions {
  const b = new Binder(startIdx);
  const conditions: string[] = [];
  if (text) {
    for (const term of text.all) {
      if (!isBlank(term)) conditions.push(...termConditions(term, b));
    }
    for (const group of text.anyOf) {
      const terms = group.filter((term) => !isBlank(term));
      if (terms.length > 0) conditions.push(`(${terms.map((term) => termExpr(term, b)).join(' OR ')})`);
    }
    for (const term of text.none) {
      if (!isBlank(term)) conditions.push(`NOT (${termExpr(term, b)})`);
    }
  }
  return { conditions, values: b.values, nextIdx: b.nextIdx };
}
