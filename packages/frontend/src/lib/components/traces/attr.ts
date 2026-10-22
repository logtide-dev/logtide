import { parseLogQuery, LOG_QUERY_LIMITS } from '@logtide/shared';

export interface AttrChip {
  /** Clause text as typed, negation included. */
  text: string;
  start: number;
  end: number;
}

export interface AttrValidation {
  ok: boolean;
  /** One chip per clause; empty when not ok. */
  chips: AttrChip[];
  /** Empty when ok. */
  error: string;
  position: number;
}

function fail(error: string, position: number): AttrValidation {
  return { ok: false, chips: [], error, position };
}

/**
 * Client side twin of the backend `parseAttrFilters`: only metadata
 * `key:value` clauses are accepted. The server stays the authority; this only
 * keeps bad input from firing a request.
 */
export function validateAttr(attr: string | null | undefined): AttrValidation {
  if (attr === null || attr === undefined || attr.trim() === '') return { ok: true, chips: [], error: '', position: 0 };

  const parsed = parseLogQuery(attr);
  if (parsed.ok === false) return fail(parsed.error.message, parsed.error.position);
  const { query, tokens } = parsed;

  const textToken = tokens.find((t) => t.kind === 'word' || t.kind === 'phrase');
  if (textToken || query.text.all.length > 0 || query.text.anyOf.length > 0 || query.text.none.length > 0) {
    return fail('Free text is not supported here, use key:value clauses', textToken ? textToken.start : 0);
  }
  if (query.fields.length > LOG_QUERY_LIMITS.maxMetadataClauses) {
    return fail(`At most ${LOG_QUERY_LIMITS.maxMetadataClauses} attribute clauses are allowed`, 0);
  }

  const fieldTokens = tokens.filter((t) => t.kind === 'field');
  const chips: AttrChip[] = [];
  for (let i = 0; i < query.fields.length; i++) {
    const tok = fieldTokens[i];
    if (!('metadata' in query.fields[i].field)) {
      return fail('Use the service and operation filters instead of built-in keys', tok?.start ?? 0);
    }
    if (!tok) continue;
    // A negation token directly before the clause belongs to it.
    const neg = tokens.find((t) => t.kind === 'negation' && t.end === tok.start);
    const start = neg ? neg.start : tok.start;
    chips.push({ text: attr.slice(start, tok.end), start, end: tok.end });
  }
  return { ok: true, chips, error: '', position: 0 };
}

/** Removes one chip's clause, joining the remaining text with a single space. */
export function removeAttrChip(attr: string, chip: AttrChip): string {
  const left = attr.slice(0, chip.start).trimEnd();
  const right = attr.slice(chip.end).trimStart();
  return left && right ? `${left} ${right}` : left || right;
}
