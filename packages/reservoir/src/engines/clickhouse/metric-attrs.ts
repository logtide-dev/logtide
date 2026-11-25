// ============================================================================
// ClickHouse metric attribute refs and filters (1.8)
// ============================================================================
// Metric data point attributes and resource attributes are JSON strings in
// the `attributes` and `resource_attributes` columns. Keys are literal: a dot
// is part of the key, never a path separator, so every key binds to exactly
// one JSON member. Values compare by their scalar text (see chScalarTextExpr):
// strings as they are, numbers and booleans by their JSON text. Every key and
// value travels as a query parameter.

import type { MetricAttrFilter, MetricAttrRef, MetricAttrScope } from '../../core/types.js';
import { chJsonScalarExpr, type ChJsonColumn, type ChJsonKeyParams } from './json-path.js';

/** JSON column holding the attributes of a scope. */
export function metricAttrColumn(scope: MetricAttrScope): ChJsonColumn {
  return scope === 'resource' ? 'resource_attributes' : 'attributes';
}

/** Binds a literal key as the query parameter `name`. */
export function bindLiteralKey(key: string, name: string, queryParams: Record<string, unknown>): ChJsonKeyParams {
  queryParams[name] = key;
  return { candidates: [[`{${name}:String}`]] };
}

/** Scalar text of an attribute as Nullable(String): NULL when missing, null, object or array. */
export function metricAttrScalarExpr(ref: MetricAttrRef, paramName: string, queryParams: Record<string, unknown>): string {
  return chJsonScalarExpr(metricAttrColumn(ref.scope), bindLiteralKey(ref.key, paramName, queryParams));
}

/** Scalar text of an attribute as String, '' when it has no text. Used as a group label. */
export function metricAttrLabelExpr(ref: MetricAttrRef, paramName: string, queryParams: Record<string, unknown>): string {
  return `ifNull(${metricAttrScalarExpr(ref, paramName, queryParams)}, '')`;
}

/**
 * Whether an attribute is present. A JSON null value counts as missing
 * (lead ruling, same as Timescale); objects and arrays count as present.
 */
export function metricAttrExistsExpr(column: ChJsonColumn, keyParams: ChJsonKeyParams): string {
  const keys = keyParams.candidates[0].join(', ');
  return `(JSONHas(${column}, ${keys}) AND JSONExtractRaw(${column}, ${keys}) != 'null')`;
}

/**
 * Compiles attribute filters into WHERE predicates (ANDed by the caller).
 * Parameters are `<prefix>k<i>` (key) and `<prefix>v<i>` (value or list).
 * A JSON null value counts as missing. neq/nin match points lacking the key;
 * gte/lt compare numerically and never match a missing or non-numeric value.
 */
export function compileMetricAttrFilters(
  filters: MetricAttrFilter[],
  queryParams: Record<string, unknown>,
  prefix: string,
): string[] {
  return filters.map((f, i) => {
    const column = metricAttrColumn(f.scope);
    const keyParams = bindLiteralKey(f.key, `${prefix}k${i}`, queryParams);
    const exists = metricAttrExistsExpr(column, keyParams);
    const scalar = chJsonScalarExpr(column, keyParams);
    const valueName = `${prefix}v${i}`;
    const value = (): string => {
      queryParams[valueName] = f.values?.[0] ?? '';
      return `{${valueName}:String}`;
    };
    const values = (): string => {
      queryParams[valueName] = [...(f.values ?? [])];
      return `{${valueName}:Array(String)}`;
    };
    const number = (): string | null => {
      const raw = f.values?.[0];
      const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
      if (!Number.isFinite(n)) return null;
      queryParams[valueName] = n;
      return `{${valueName}:Float64}`;
    };

    switch (f.op) {
      case 'eq':
        return `ifNull(${scalar} = ${value()}, 0)`;
      case 'neq':
        return `(NOT (${exists}) OR ifNull(${scalar} != ${value()}, 1))`;
      case 'in':
        if (!f.values || f.values.length === 0) return '0';
        return `ifNull(${scalar} IN ${values()}, 0)`;
      case 'nin':
        if (!f.values || f.values.length === 0) return '1';
        return `(NOT (${exists}) OR ifNull(${scalar} NOT IN ${values()}, 1))`;
      case 'exists':
        return exists;
      case 'notExists':
        return `NOT (${exists})`;
      case 'gte': {
        const n = number();
        return n === null ? '0' : `ifNull(toFloat64OrNull(${scalar}) >= ${n}, 0)`;
      }
      case 'lt': {
        const n = number();
        return n === null ? '0' : `ifNull(toFloat64OrNull(${scalar}) < ${n}, 0)`;
      }
      default:
        throw new Error(`Unsupported metric attribute filter op: ${String((f as { op: unknown }).op)}`);
    }
  });
}
