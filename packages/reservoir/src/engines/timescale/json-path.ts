// ============================================================================
// TimescaleDB JSON key resolution (spec 5.3, plan S4 and S5)
// ============================================================================
// One resolver for log `metadata` and span `attributes`/`resource_attributes`.
// A key without `.` is `col->>key` (today's SQL, kept byte for byte). A key
// with `.` resolves like `resolveMetadataPath`: the literal key when the
// object has it, else the nested path `key.split('.')`. `->>` already gives
// numbers and booleans their JSON text (`500`, `true`), so values compare by
// text. Negative operators with `include_missing` match records where the key
// does not resolve, because the text expression is NULL there.
//
// Keys, paths and values are always bound parameters; only the column name
// is interpolated, and it comes from a fixed allowlist.

import type { MetadataFilter } from '../../core/types.js';
import { escapeIlike } from './text-query.js';

export type JsonColumn = 'metadata' | 'attributes' | 'resource_attributes' | 's.attributes' | 's.resource_attributes';

const JSON_COLUMNS = new Set<string>(['metadata', 'attributes', 'resource_attributes', 's.attributes', 's.resource_attributes']);

function checkColumn(column: string): void {
  if (!JSON_COLUMNS.has(column)) throw new Error('Unsupported JSON column');
}

/** Text of the key (NULL when it does not resolve); `pathIdx` is the bound `text[]` path of a dotted key. */
export function jsonTextExpr(column: JsonColumn, keyIdx: number, pathIdx: number | null): string {
  checkColumn(column);
  if (pathIdx === null) return `${column}->>$${keyIdx}`;
  return `CASE WHEN ${column} ? $${keyIdx} THEN ${column}->>$${keyIdx} ELSE ${column} #>> $${pathIdx}::text[] END`;
}

/** The jsonb value of the key (SQL NULL when it does not resolve). */
export function jsonValueExpr(column: JsonColumn, keyIdx: number, pathIdx: number | null): string {
  checkColumn(column);
  if (pathIdx === null) return `${column}->$${keyIdx}`;
  return `CASE WHEN ${column} ? $${keyIdx} THEN ${column}->$${keyIdx} ELSE ${column} #> $${pathIdx}::text[] END`;
}

/** True when the key resolves, whatever its value (JSON null included). */
export function jsonExistsExpr(column: JsonColumn, keyIdx: number, pathIdx: number | null): string {
  checkColumn(column);
  if (pathIdx === null) return `${column} ? $${keyIdx}`;
  return `(${column} ? $${keyIdx} OR ${column} #> $${pathIdx}::text[] IS NOT NULL)`;
}

/** S5 text form of a jsonb expression: strings, numbers and booleans; NULL for null, objects and arrays. */
export function scalarTextExpr(jsonbExpr: string): string {
  return `CASE WHEN jsonb_typeof(${jsonbExpr}) IN ('string', 'number', 'boolean') THEN (${jsonbExpr}) #>> '{}' END`;
}

/**
 * WHERE conditions for metadata (or span attribute) filters, AND-ed, bound
 * from `startIdx`: per filter the key, then the `text[]` path of a dotted
 * key, then the value or value list.
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
    const keyIdx = idx++;
    values.push(f.key);
    let pathIdx: number | null = null;
    if (f.key.includes('.')) {
      pathIdx = idx++;
      values.push(f.key.split('.'));
    }
    const text = jsonTextExpr(column, keyIdx, pathIdx);
    const exists = jsonExistsExpr(column, keyIdx, pathIdx);
    const bind = (value: unknown): string => {
      values.push(value);
      return `$${idx++}`;
    };

    switch (f.op) {
      case 'equals':
        conditions.push(`(${text} = ${bind(f.value)})`);
        break;
      case 'not_equals':
        conditions.push(
          f.include_missing
            ? `(${text} IS DISTINCT FROM ${bind(f.value)})`
            : `(${exists} AND ${text} <> ${bind(f.value)})`,
        );
        break;
      case 'in':
        conditions.push(`(${text} = ANY(${bind(f.values)}))`);
        break;
      case 'not_in':
        conditions.push(
          f.include_missing
            ? `(${text} IS NULL OR ${text} <> ALL(${bind(f.values)}))`
            : `(${exists} AND ${text} <> ALL(${bind(f.values)}))`,
        );
        break;
      case 'exists':
        conditions.push(`(${exists})`);
        break;
      case 'not_exists':
        // `col ? key` is NULL on a NULL column (logs without metadata, spans
        // without attributes), and NOT NULL would drop the record.
        conditions.push(pathIdx === null ? `(${column} IS NULL OR NOT (${exists}))` : `(${column} IS NULL OR NOT ${exists})`);
        break;
      case 'contains':
        conditions.push(`(${text} ILIKE ${bind(`%${escapeIlike(f.value ?? '')}%`)})`);
        break;
    }
  }

  return { conditions, values, nextIdx: idx };
}
