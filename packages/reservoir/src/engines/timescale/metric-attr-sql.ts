// ============================================================================
// Metric attribute SQL (1.8)
// ============================================================================
// Builds the WHERE fragments and the group-by expressions for metric and
// resource attributes. Keys and values are always bound parameters; only the
// column name (fixed by scope) and the parameter numbers are interpolated.

import type { MetricAttrFilter, MetricAttrScope } from '../../core/types.js';

/** Collects bound values and hands out their placeholders. */
export class SqlParams {
  constructor(readonly values: unknown[] = []) {}

  /** Binds a value and returns its placeholder ("$n"). */
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/** JSONB column that holds the attributes of a scope. */
export function metricAttrColumn(scope: MetricAttrScope): string {
  return scope === 'resource' ? 'resource_attributes' : 'attributes';
}

/**
 * Text form of an attribute: strings as is, numbers and booleans as their
 * JSON scalar (200, true). SQL NULL when the key is missing or JSON null.
 */
export function metricAttrText(scope: MetricAttrScope, keyPlaceholder: string): string {
  return `(${metricAttrColumn(scope)}->>${keyPlaceholder})`;
}

/**
 * A decimal literal both JS and Postgres numeric accept. The exponent is
 * capped at three digits so a cast can never overflow numeric.
 */
const NUMERIC_TEXT = /^[-+]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][-+]?[0-9]{1,3})?$/;
const NUMERIC_TEXT_SQL = `'^[-+]?([0-9]+(\\.[0-9]*)?|\\.[0-9]+)([eE][-+]?[0-9]{1,3})?$'`;

/**
 * SQL condition for one filter. Degenerate filters (no value where one is
 * needed, a non-numeric bound) become constants without binding anything,
 * since Postgres rejects bound parameters the statement does not use.
 */
export function metricAttrFilterSql(filter: MetricAttrFilter, params: SqlParams): string {
  const values = filter.values ?? [];
  const text = () => metricAttrText(filter.scope, params.add(filter.key));
  switch (filter.op) {
    case 'eq':
      return values.length > 0 ? `${text()} = ${params.add(values[0])}` : 'FALSE';
    case 'neq':
      // A point lacking the key matches.
      return values.length > 0 ? `${text()} IS DISTINCT FROM ${params.add(values[0])}` : 'TRUE';
    case 'in':
      return values.length > 0 ? `${text()} = ANY(${params.add(values)}::text[])` : 'FALSE';
    case 'nin': {
      if (values.length === 0) return 'TRUE';
      const t = text();
      return `(${t} IS NULL OR NOT (${t} = ANY(${params.add(values)}::text[])))`;
    }
    case 'exists':
      return `${text()} IS NOT NULL`;
    case 'notExists':
      return `${text()} IS NULL`;
    case 'gte':
    case 'lt': {
      const raw = (values[0] ?? '').trim();
      if (!NUMERIC_TEXT.test(raw)) return 'FALSE';
      const t = text();
      const operator = filter.op === 'gte' ? '>=' : '<';
      // CASE keeps the cast away from non-numeric text; the result is NULL
      // (no match) for a missing or non-numeric attribute.
      return `(CASE WHEN ${t} ~ ${NUMERIC_TEXT_SQL} THEN ${t}::numeric END) ${operator} ${params.add(raw)}::numeric`;
    }
    default:
      return 'FALSE';
  }
}

/** ANDed conditions for a filter list (empty when there is none). */
export function metricAttrFiltersSql(filters: MetricAttrFilter[] | undefined, params: SqlParams): string[] {
  return (filters ?? []).map((f) => metricAttrFilterSql(f, params));
}

/** LIKE pattern matching names that start with a literal prefix. */
export function likePrefixPattern(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
