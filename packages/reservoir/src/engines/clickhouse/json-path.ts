// ============================================================================
// ClickHouse JSON key resolution and scalar text (plan S4, S5)
// ============================================================================
// Metadata and span attributes are JSON strings. A key resolves to the
// literal key when the object has it, else to the nested path of its dot
// separated segments (the `resolveMetadataPath` rule). Values compare by
// their scalar text: strings as they are, numbers by their JSON text,
// booleans as `true`/`false`; null, objects and arrays have no text.
// Every key, segment and value travels as a query parameter.

import type { MetadataFilter } from '../../core/types.js';

export type ChJsonColumn = 'metadata' | 'attributes' | 'resource_attributes';

const JSON_COLUMNS: ReadonlySet<string> = new Set<ChJsonColumn>(['metadata', 'attributes', 'resource_attributes']);

/** SQL placeholders of a key: the whole key, plus its segments when it is dotted. */
export interface ChJsonKeyParams {
  key: string;
  segments: string[] | null;
}

function checkColumn(column: string): void {
  if (!JSON_COLUMNS.has(column)) throw new Error('Unsupported JSON column');
}

/** The raw JSON text of the resolved value, `''` when the key does not resolve. */
export function chJsonRawExpr(column: ChJsonColumn, keyParams: ChJsonKeyParams): string {
  checkColumn(column);
  const literal = `JSONExtractRaw(${column}, ${keyParams.key})`;
  if (!keyParams.segments) return literal;
  return `if(JSONHas(${column}, ${keyParams.key}), ${literal}, JSONExtractRaw(${column}, ${keyParams.segments.join(', ')}))`;
}

/** Whether the key resolves (present with any value, null included). */
export function chJsonExistsExpr(column: ChJsonColumn, keyParams: ChJsonKeyParams): string {
  checkColumn(column);
  const literal = `JSONHas(${column}, ${keyParams.key})`;
  if (!keyParams.segments) return literal;
  return `(${literal} OR JSONHas(${column}, ${keyParams.segments.join(', ')}))`;
}

/** Scalar text of a raw JSON value as Nullable(String): NULL for missing, null, objects and arrays. */
export function chScalarTextExpr(raw: string): string {
  return `multiIf(${raw} = '' OR ${raw} = 'null' OR startsWith(${raw}, '{') OR startsWith(${raw}, '['), NULL, startsWith(${raw}, '"'), JSONExtractString(${raw}), ${raw})`;
}

/**
 * Compiles metadata filters over one JSON column into WHERE predicates
 * (ANDed by the caller). Parameters are `<prefix>k<i>` (key),
 * `<prefix>k<i>s<j>` (segments of a dotted key) and `<prefix>v<i>` (value or
 * list). Negative operators match records where the key does not resolve
 * unless `include_missing` is explicitly false.
 */
export function compileJsonFilters(
  filters: MetadataFilter[],
  column: ChJsonColumn,
  queryParams: Record<string, unknown>,
  prefix: string,
): string[] {
  checkColumn(column);
  return filters.map((f, i) => {
    const keyName = `${prefix}k${i}`;
    queryParams[keyName] = f.key;
    let segments: string[] | null = null;
    if (f.key.includes('.')) {
      segments = f.key.split('.').map((segment, j) => {
        const name = `${keyName}s${j}`;
        queryParams[name] = segment;
        return `{${name}:String}`;
      });
    }
    const keyParams: ChJsonKeyParams = { key: `{${keyName}:String}`, segments };
    const exists = chJsonExistsExpr(column, keyParams);
    const scalar = chScalarTextExpr(chJsonRawExpr(column, keyParams));
    const valueName = `${prefix}v${i}`;
    const value = (): string => {
      queryParams[valueName] = f.value ?? '';
      return `{${valueName}:String}`;
    };
    const values = (): string => {
      queryParams[valueName] = [...(f.values ?? [])];
      return `{${valueName}:Array(String)}`;
    };
    const keepMissing = f.include_missing !== false;

    switch (f.op) {
      case 'equals':
        return `${scalar} = ${value()}`;
      case 'in':
        return `${scalar} IN ${values()}`;
      case 'not_equals': {
        const v = value();
        return keepMissing ? `(NOT (${exists}) OR ifNull(${scalar} != ${v}, 1))` : `(${exists} AND ${scalar} != ${v})`;
      }
      case 'not_in': {
        const vs = values();
        return keepMissing ? `(NOT (${exists}) OR ifNull(${scalar} NOT IN ${vs}, 1))` : `(${exists} AND ${scalar} NOT IN ${vs})`;
      }
      case 'exists':
        return exists;
      case 'not_exists':
        return `NOT (${exists})`;
      case 'contains':
        return `ifNull(positionCaseInsensitiveUTF8(${scalar}, ${value()}), 0) > 0`;
    }
  });
}
