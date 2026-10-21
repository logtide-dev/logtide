// Legacy `search` / `searchMode` to `textQuery` (plan D4). Engines read only
// `textQuery`; the client derives it here so there is one code path.

import { legacySubstringQuery, tokenizeWords } from '@logtide/shared';
import type { SearchMode, TextQuery } from './types.js';

/**
 * Converts the legacy search params without parsing the query grammar:
 * `substring` is one phrase with the raw string; `fulltext` (the default) is
 * the AND of the string's words, or one phrase of the trimmed string when it
 * has no word characters. Blank or missing input gives undefined.
 */
export function legacySearchToTextQuery(search: string | undefined, searchMode?: SearchMode): TextQuery | undefined {
  if (search === undefined || search.trim() === '') return undefined;
  if (searchMode === 'substring') return legacySubstringQuery(search).text;
  const words = tokenizeWords(search);
  if (words.length === 0) return { all: [{ kind: 'phrase', value: search.trim() }], anyOf: [], none: [] };
  return { all: words.map((value) => ({ kind: 'word' as const, value })), anyOf: [], none: [] };
}

export function isEmptyTextQuery(q: TextQuery): boolean {
  return q.all.length === 0 && q.anyOf.length === 0 && q.none.length === 0;
}
