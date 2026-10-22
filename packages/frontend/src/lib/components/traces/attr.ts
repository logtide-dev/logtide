import { parseLogQuery, LOG_QUERY_LIMITS } from '@logtide/shared';

export interface AttrChip {
  /** Clause text as typed, negation included. */
  text: string;
  start: number;
  end: number;
}

export type AttrValidation =
  | { ok: true; chips: AttrChip[] }
  | { ok: false; error: string; position: number };

/**
 * Client side twin of the backend `parseAttrFilters`: only metadata
 * `key:value` clauses are accepted. The server stays the authority; this only
 * keeps bad input from firing a request.
 */
export function validateAttr(attr: string | null | undefined): AttrValidation {
  if (attr === null || attr === undefined || attr.trim() === '') return { ok: true, chips: [] };

  const parsed = parseLogQuery(attr);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error.message, position: parsed.error.position };
  }
  const { query, tokens } = parsed;

  const textToken = tokens.find((t) => t.kind === 'word' || t.kind === 'phrase');
  if (textToken || query.text.all.length > 0 || query.text.anyOf.length > 0 || query.text.none.length > 0) {
    return {
      ok: false,
      error: 'Free text is not supported here, use key:value clauses',
      position: textToken ? textToken.start : 0,
    };
  }
  if (query.fields.length > LOG_QUERY_LIMITS.maxMetadataClauses) {
    return {
      ok: false,
      error: `At most ${LOG_QUERY_LIMITS.maxMetadataClauses} attribute clauses are allowed`,
      position: 0,
    };
  }

  const fieldTokens = tokens.filter((t) => t.kind === 'field');
  const chips: AttrChip[] = [];
  for (let i = 0; i < query.fields.length; i++) {
    const tok = fieldTokens[i];
    if (!('metadata' in query.fields[i].field)) {
      return {
        ok: false,
        error: 'Use the service and operation filters instead of built-in keys',
        position: tok?.start ?? 0,
      };
    }
    if (!tok) continue;
    // A negation token directly before the clause belongs to it.
    const neg = tokens.find((t) => t.kind === 'negation' && t.end === tok.start);
    const start = neg ? neg.start : tok.start;
    chips.push({ text: attr.slice(start, tok.end), start, end: tok.end });
  }
  return { ok: true, chips };
}

/** Removes one chip's clause, joining the remaining text with a single space. */
export function removeAttrChip(attr: string, chip: AttrChip): string {
  const left = attr.slice(0, chip.start).trimEnd();
  const right = attr.slice(chip.end).trimStart();
  return left && right ? `${left} ${right}` : left || right;
}
