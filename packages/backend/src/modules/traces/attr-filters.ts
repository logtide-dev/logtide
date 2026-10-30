import { parseLogQuery, metadataFilterSchema, LOG_QUERY_LIMITS } from '@logtide/shared';
import type { FieldClause, MetadataFilter } from '@logtide/shared';

export type AttrParseResult =
  | { ok: true; filters: MetadataFilter[] }
  | { ok: false; error: string; position: number };

/**
 * Parses the `attr` param of the trace list (F3 field-clause syntax) into
 * metadata filters. Only metadata keys are accepted: free text and built-in
 * keys (service:, level:, trace: ...) have their own filters or do not apply
 * to spans.
 */
export function parseAttrFilters(attr: string | undefined | null): AttrParseResult {
  if (attr === undefined || attr === null || attr.trim() === '') {
    return { ok: true, filters: [] };
  }

  const parsed = parseLogQuery(attr);
  if (!parsed.ok) {
    // The clause-count error is about the whole input, not one clause.
    const tooMany = parsed.error.message.startsWith('Too many field filters');
    return { ok: false, error: parsed.error.message, position: tooMany ? 0 : parsed.error.position };
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
  const filters: MetadataFilter[] = [];

  for (let i = 0; i < query.fields.length; i++) {
    const clause: FieldClause = query.fields[i];
    if (!('metadata' in clause.field)) {
      return {
        ok: false,
        error: 'Use the service and operation filters instead of built-in keys',
        position: fieldTokens[i]?.start ?? 0,
      };
    }
    const key = clause.field.metadata;
    const raw =
      clause.op === 'in' || clause.op === 'not_in'
        ? { key, op: clause.op, values: clause.values }
        : clause.op === 'exists' || clause.op === 'not_exists'
          ? { key, op: clause.op }
          : { key, op: clause.op, value: (clause as { value?: string }).value };
    const result = metadataFilterSchema.safeParse(raw);
    if (!result.success) {
      return {
        ok: false,
        error: result.error.issues[0]?.message ?? 'Invalid attribute filter',
        position: fieldTokens[i]?.start ?? 0,
      };
    }
    filters.push(result.data);
  }

  return { ok: true, filters };
}
