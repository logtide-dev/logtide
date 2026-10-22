// ============================================================================
// TimescaleDB JSON key resolution (spec 5.3, plan S4 and S5)
// ============================================================================
// One resolver for log `metadata` and span `attributes`/`resource_attributes`.
// A key without `.` is `col->key`. A key with `.` resolves like
// `resolveMetadataPath`: the candidate key sequences of the shared
// `metadataPathCandidates`, in order, the first that exists wins. Each
// candidate is a chain of `->` with text keys, which reads object members
// only (it never indexes an array). Values compare by their S5 text form:
// strings, numbers (`500`) and booleans (`true`); null, objects and arrays
// have no text, so they never equal, contain or list-match a value. Negative
// operators with `include_missing` match records where the key does not
// resolve (or has no text); with `include_missing: false` the key must
// resolve, whatever its value.
//
// Keys, paths and values are always bound parameters; only the column name
// is interpolated, and it comes from a fixed allowlist. A dotted key binds
// one `text[]` holding the keys of every candidate, read by position.

import { metadataPathCandidates } from '@logtide/shared';
import type { MetadataFilter } from '../../core/types.js';
import { escapeIlike } from './text-query.js';

export type JsonColumn = 'metadata' | 'attributes' | 'resource_attributes' | 's.attributes' | 's.resource_attributes';

const JSON_COLUMNS = new Set<string>(['metadata', 'attributes', 'resource_attributes', 's.attributes', 's.resource_attributes']);

function checkColumn(column: string): void {
  if (!JSON_COLUMNS.has(column)) throw new Error('Unsupported JSON column');
}

/** The SQL that reads one bound key. */
export interface BoundJsonKey {
  /** The jsonb value the key resolves to (SQL NULL when it does not resolve). */
  value: string;
  /** S5 text of the resolved value: NULL when missing, null, an object or an array. */
  text: string;
  /** True when the key resolves, whatever its value (JSON null included). */
  exists: string;
}

/**
 * Binds `key` against `column` from parameter `idx`: a plain key binds the
 * key, a dotted key one `text[]` with the keys of every candidate in order.
 */
export function bindJsonKey(
  column: JsonColumn,
  key: string,
  idx: number,
): { key: BoundJsonKey; values: unknown[]; nextIdx: number } {
  checkColumn(column);
  if (!key.includes('.')) {
    const value = `${column}->$${idx}`;
    return {
      key: { value, text: scalarTextExpr(value), exists: `${column} ? $${idx}` },
      values: [key],
      nextIdx: idx + 1,
    };
  }
  const flat: string[] = [];
  const chains = metadataPathCandidates(key).map((keys) => {
    let chain = column as string;
    for (const k of keys) {
      flat.push(k);
      chain += ` -> ($${idx}::text[])[${flat.length}]`;
    }
    return chain;
  });
  const value = `COALESCE(${chains.join(', ')})`;
  return {
    key: { value, text: scalarTextExpr(value), exists: `(${value}) IS NOT NULL` },
    values: [flat],
    nextIdx: idx + 1,
  };
}

/** S5 text form of a jsonb expression: strings, numbers and booleans; NULL for null, objects and arrays. */
export function scalarTextExpr(jsonbExpr: string): string {
  return `CASE WHEN jsonb_typeof(${jsonbExpr}) IN ('string', 'number', 'boolean') THEN (${jsonbExpr}) #>> '{}' END`;
}

/**
 * WHERE conditions for metadata (or span attribute) filters, AND-ed, bound
 * from `startIdx`: per filter the key (see bindJsonKey), then the value or
 * value list.
 */
export function compileJsonFilters(
  filters: MetadataFilter[],
  column: JsonColumn,
  startIdx: number,
): { conditions: string[]; values: unknown[]; nextIdx: number } {
  checkColumn(column);
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = startIdx;

  for (const f of filters) {
    const bound = bindJsonKey(column, f.key, idx);
    values.push(...bound.values);
    idx = bound.nextIdx;
    const { text, exists } = bound.key;
    const bind = (value: unknown): string => {
      values.push(value);
      return `$${idx++}`;
    };

    switch (f.op) {
      case 'equals':
        conditions.push(`(${text} = ${bind(f.value)})`);
        break;
      case 'not_equals': {
        // A value without text (null, object, array) differs from every value.
        const differs = `${text} IS DISTINCT FROM ${bind(f.value)}`;
        conditions.push(f.include_missing ? `(${differs})` : `(${exists} AND ${differs})`);
        break;
      }
      case 'in':
        conditions.push(`(${text} = ANY(${bind(f.values)}))`);
        break;
      case 'not_in': {
        const outside = `(${text} IS NULL OR ${text} <> ALL(${bind(f.values)}))`;
        conditions.push(f.include_missing ? outside : `(${exists} AND ${outside})`);
        break;
      }
      case 'exists':
        conditions.push(`(${exists})`);
        break;
      case 'not_exists':
        // `col ? key` is NULL on a NULL column (logs without metadata, spans
        // without attributes), and NOT NULL would drop the record.
        conditions.push(`(${column} IS NULL OR NOT (${exists}))`);
        break;
      case 'contains':
        conditions.push(`(${text} ILIKE ${bind(`%${escapeIlike(f.value ?? '')}%`)})`);
        break;
    }
  }

  return { conditions, values, nextIdx: idx };
}
