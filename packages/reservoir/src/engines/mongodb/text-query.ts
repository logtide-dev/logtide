// ============================================================================
// MongoDB free-text terms (spec 5.3, plan S1 to S3)
// ============================================================================
// Words match whole tokens of `message` case-insensitively without stemming;
// phrases are case-insensitive substrings. Both compile to `$regex` clauses
// that the log filter ANDs into its single `$and` list. `$text` is never
// emitted: it ORs words, stems English, drops stop words, cannot sit inside
// `$or`/`$nor`, and time-series `logs` collections (the production default
// on MongoDB 5+) cannot have a text index.

import type { Document } from 'mongodb';
import { tokenizeWords } from '@logtide/shared';
import { legacySearchToTextQuery } from '../../core/text-query.js';
import type { SearchMode, TextQuery } from '../../core/types.js';

type TextTerm = TextQuery['all'][number];

/** A character that cannot be part of a word token (not a letter, digit or `_`). */
const NON_WORD = '[^\\p{L}\\p{N}_]';

/** Escapes regex metacharacters so user text matches literally. */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The text query an engine runs: `textQuery` wins; otherwise the legacy
 * `search`/`searchMode` converted like the client does (substring is one
 * phrase, fulltext the AND of its words). Undefined when there is no text.
 */
export function resolveTextQuery(params: { textQuery?: TextQuery; search?: string; searchMode?: SearchMode }): TextQuery | undefined {
  if (params.textQuery !== undefined) return params.textQuery;
  return legacySearchToTextQuery(params.search, params.searchMode);
}

/** Whole-token, case-insensitive match of one word token. */
function tokenClause(token: string): Document {
  return { message: { $regex: `(?:^|${NON_WORD})${escapeRegex(token)}(?:$|${NON_WORD})`, $options: 'i' } };
}

function phraseClause(value: string): Document {
  return { message: { $regex: escapeRegex(value), $options: 'i' } };
}

/** One term as a clause; null for a blank term (ignored). */
function termClause(term: TextTerm): Document | null {
  if (term.value.trim() === '') return null;
  if (term.kind === 'phrase') return phraseClause(term.value);
  const tokens = tokenizeWords(term.value);
  // A word without word characters can only be matched as written.
  if (tokens.length === 0) return phraseClause(term.value);
  if (tokens.length === 1) return tokenClause(tokens[0]);
  return { $and: tokens.map(tokenClause) };
}

function clausesOf(terms: TextTerm[]): Document[] {
  return terms.map(termClause).filter((c): c is Document => c !== null);
}

/**
 * Clauses for the log filter's `$and` list: one per `all` term, one `$or`
 * per `anyOf` group (a single-term group is the term itself), and one
 * `$nor` holding every `none` term. Empty parts add nothing.
 */
export function compileTextQuery(text: TextQuery): Document[] {
  const out = clausesOf(text.all);
  for (const group of text.anyOf) {
    const clauses = clausesOf(group);
    if (clauses.length === 1) out.push(clauses[0]);
    else if (clauses.length > 1) out.push({ $or: clauses });
  }
  const none = clausesOf(text.none);
  if (none.length > 0) out.push({ $nor: none });
  return out;
}
