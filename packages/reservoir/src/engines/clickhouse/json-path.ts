// ============================================================================
// ClickHouse JSON key resolution and scalar text (plan S4, S5)
// ============================================================================
// Metadata and span attributes are JSON strings. A key resolves like
// `resolveMetadataPath`: through the first present candidate key sequence of
// the shared `metadataPathCandidates` (the literal key first). String
// arguments of the JSON functions read object members only, so a path never
// indexes an array. Values compare by their scalar text: strings as they
// are, numbers by their JSON text, booleans as `true`/`false`; null, objects
// and arrays have no text. Every key and value travels as a query parameter.

import { metadataPathCandidates } from '@logtide/shared';
import type { MetadataFilter } from '../../core/types.js';

export type ChJsonColumn = 'metadata' | 'attributes' | 'resource_attributes';

const JSON_COLUMNS: ReadonlySet<string> = new Set<ChJsonColumn>(['metadata', 'attributes', 'resource_attributes']);

/** SQL placeholders of a key: one placeholder list per candidate key sequence, in precedence order. */
export interface ChJsonKeyParams {
  candidates: string[][];
}

function checkColumn(column: string): void {
  if (!JSON_COLUMNS.has(column)) throw new Error('Unsupported JSON column');
}

/**
 * Binds a key as query parameters for the candidates of the shared
 * `metadataPathCandidates`: `name` holds the whole key and `<name>s<j>` every
 * other distinct key string, numbered in order of first use.
 */
export function bindJsonKey(key: string, name: string, queryParams: Record<string, unknown>): ChJsonKeyParams {
  const placeholders = new Map<string, string>();
  const placeholder = (k: string): string => {
    let p = placeholders.get(k);
    if (!p) {
      const paramName = placeholders.size === 0 ? name : `${name}s${placeholders.size - 1}`;
      queryParams[paramName] = k;
      p = `{${paramName}:String}`;
      placeholders.set(k, p);
    }
    return p;
  };
  placeholder(key);
  return { candidates: metadataPathCandidates(key).map((keys) => keys.map(placeholder)) };
}

/** Scalar text (see chScalarTextExpr) of a key resolved against a JSON column. */
export function chJsonScalarExpr(column: ChJsonColumn, keyParams: ChJsonKeyParams): string {
  return chScalarTextExpr(chJsonRawExpr(column, keyParams));
}

/** The raw JSON text of the resolved value (the first candidate present), `''` when the key does not resolve. */
export function chJsonRawExpr(column: ChJsonColumn, keyParams: ChJsonKeyParams): string {
  checkColumn(column);
  const raws = keyParams.candidates.map((keys) => `JSONExtractRaw(${column}, ${keys.join(', ')})`);
  if (raws.length === 1) return raws[0];
  const branches = keyParams.candidates
    .slice(0, -1)
    .map((keys, i) => `JSONHas(${column}, ${keys.join(', ')}), ${raws[i]}`);
  return `multiIf(${branches.join(', ')}, ${raws[raws.length - 1]})`;
}

/** Whether the key resolves (some candidate present, with any value, null included). */
export function chJsonExistsExpr(column: ChJsonColumn, keyParams: ChJsonKeyParams): string {
  checkColumn(column);
  const has = keyParams.candidates.map((keys) => `JSONHas(${column}, ${keys.join(', ')})`);
  return has.length === 1 ? has[0] : `(${has.join(' OR ')})`;
}

/** Scalar text of a raw JSON value as Nullable(String): NULL for missing, null, objects and arrays. */
export function chScalarTextExpr(raw: string): string {
  return `multiIf(${raw} = '' OR ${raw} = 'null' OR startsWith(${raw}, '{') OR startsWith(${raw}, '['), NULL, startsWith(${raw}, '"'), JSONExtractString(${raw}), ${raw})`;
}

/**
 * Compiles metadata filters over one JSON column into WHERE predicates
 * (ANDed by the caller). Parameters are `<prefix>k<i>` (key),
 * `<prefix>k<i>s<j>` (the other key strings of a dotted key) and `<prefix>v<i>` (value or
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
    const keyParams = bindJsonKey(f.key, `${prefix}k${i}`, queryParams);
    const exists = chJsonExistsExpr(column, keyParams);
    const scalar = chJsonScalarExpr(column, keyParams);
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
