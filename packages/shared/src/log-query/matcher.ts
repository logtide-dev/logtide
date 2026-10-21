// ============================================================================
// matchesLogSearch: in-memory evaluation of a parsed query (plan D3)
// ============================================================================
// Used by live tail and as the conformance oracle, so every engine must give
// the same answer on the conformance corpus.

import { resolveMetadataPath } from '../utils/metadata-path.js';
import { metadataValueText, tokenizeWords } from './tokenize.js';
import type { BuiltinField, FieldClause, LogSearchQuery, MatchableLog, TextTerm } from './types.js';

function builtinValue(log: MatchableLog, field: BuiltinField): string | undefined {
  switch (field) {
    case 'level':
      return log.level ?? undefined;
    case 'service':
      return log.service ?? undefined;
    case 'hostname': {
      // Engines filter on metadata.hostname, which is where ingestion stores it.
      const fromMetadata = log.metadata?.hostname;
      return typeof fromMetadata === 'string' ? fromMetadata : (log.hostname ?? undefined);
    }
    case 'traceId':
      return log.traceId ?? undefined;
    case 'sessionId':
      return log.sessionId ?? undefined;
    case 'spanId':
      return log.spanId ?? undefined;
  }
}

function clauseMatches(log: MatchableLog, clause: FieldClause): boolean {
  const resolved =
    'builtin' in clause.field
      ? builtinValue(log, clause.field.builtin)
      : resolveMetadataPath(log.metadata, clause.field.metadata);
  const text = metadataValueText(resolved);
  switch (clause.op) {
    case 'equals':
      return text !== undefined && text === clause.value;
    case 'not_equals':
      return !(text !== undefined && text === clause.value);
    case 'in':
      return text !== undefined && clause.values.includes(text);
    case 'not_in':
      return !(text !== undefined && clause.values.includes(text));
    case 'exists':
      return resolved !== undefined;
    case 'not_exists':
      return resolved === undefined;
    case 'contains':
      return text !== undefined && clause.value !== undefined && text.toLowerCase().includes(clause.value.toLowerCase());
  }
}

/**
 * True when the log matches every part of the query: free text against the
 * message (words by token, phrases by case-insensitive substring), built-ins
 * exactly, metadata by text form. Negative clauses match missing keys.
 */
export function matchesLogSearch(log: MatchableLog, query: LogSearchQuery): boolean {
  let words: Set<string> | undefined;
  let lowerMessage: string | undefined;
  const termMatches = (term: TextTerm): boolean => {
    if (term.kind === 'word') {
      words ??= new Set(tokenizeWords(log.message));
      return words.has(term.value.toLowerCase());
    }
    lowerMessage ??= log.message.toLowerCase();
    return lowerMessage.includes(term.value.toLowerCase());
  };
  const { all, anyOf, none } = query.text;
  if (!all.every(termMatches)) return false;
  if (!anyOf.every((group) => group.some(termMatches))) return false;
  if (none.some(termMatches)) return false;
  return query.fields.every((clause) => clauseMatches(log, clause));
}
