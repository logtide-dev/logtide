// ============================================================================
// MongoDB JSON key resolution and scalar text (plan S4, S5)
// ============================================================================
// Metadata (logs) and attribute (spans) filters compare the TEXT form of the
// value the key resolves to, the `resolveMetadataPath` + `metadataValueText`
// rules of the shared matcher:
// - a key without `.` is `obj[key]`; a dotted key is the literal key when the
//   object has it, otherwise the walk through nested objects;
// - strings are themselves, numbers and booleans their text (`500`, `true`),
//   null, objects and arrays have no text;
// - negative operators match records where the key does not resolve, unless
//   `include_missing` is explicitly false.
//
// Keys without `.` (and not starting with `$`) use native operators on
// `<root>.<key>` so indexes stay usable; numbers and booleans are matched
// through extra `$in` candidates. Dot notation alone is never used for a
// dotted key: it cannot see literal keys such as `http.status_code`, so those
// keys (and `$`-prefixed ones, and every `contains`) go through `$expr`.

import type { Document } from 'mongodb';
import type { MetadataFilter } from '../../core/types.js';
import { escapeRegex } from './text-query.js';

export type MgJsonRoot = 'metadata' | 'attributes' | 'resource_attributes';

const ROOTS: ReadonlySet<string> = new Set<MgJsonRoot>(['metadata', 'attributes', 'resource_attributes']);

function rootRef(root: MgJsonRoot): string {
  if (!ROOTS.has(root)) throw new Error('Unsupported JSON root');
  return `$${root}`;
}

/**
 * `input[name]` when `input` is an object, otherwise missing (`$getField`
 * errors on non-objects). The input is bound once so nested segments grow
 * the expression linearly.
 */
function fieldOf(input: unknown, name: string): Document {
  return {
    $let: {
      vars: { o: input },
      in: {
        $cond: [
          { $eq: [{ $type: '$$o' }, 'object'] },
          { $getField: { field: { $literal: name }, input: '$$o' } },
          '$$REMOVE',
        ],
      },
    },
  };
}

/**
 * The value `key` resolves to under `root` (S4), as an aggregation
 * expression; missing when it does not resolve. A dotted key takes the
 * literal key when present, otherwise walks the segments through objects.
 */
export function resolvedValueExpr(root: MgJsonRoot, key: string): Document {
  const ref = rootRef(root);
  const literal = fieldOf(ref, key);
  if (!key.includes('.')) return literal;
  const nested = key.split('.').reduce<unknown>((acc, segment) => fieldOf(acc, segment), ref) as Document;
  return {
    $let: {
      vars: { lit: literal },
      in: { $cond: [{ $ne: [{ $type: '$$lit' }, 'missing'] }, '$$lit', nested] },
    },
  };
}

/** S5 text form of `expr`: strings as they are, numbers and booleans via `$toString`, anything else null. */
export function scalarTextExpr(expr: Document): Document {
  return {
    $let: {
      vars: { v: expr },
      in: {
        $switch: {
          branches: [
            { case: { $eq: [{ $type: '$$v' }, 'string'] }, then: '$$v' },
            { case: { $in: [{ $type: '$$v' }, ['int', 'long', 'double', 'decimal', 'bool']] }, then: { $toString: '$$v' } },
          ],
          default: null,
        },
      },
    },
  };
}

/** True when the expression resolves (present, any value including null). */
function resolvesExpr(resolved: Document): Document {
  return { $ne: [{ $type: resolved }, 'missing'] };
}

/**
 * Stored values whose text form is `value`: the string itself, plus the
 * number when `value` is the canonical text of a finite number (`500`,
 * `1.5`, not `007` or `1e3`), plus the boolean for `true` / `false`.
 */
export function textCandidates(value: string): unknown[] {
  const out: unknown[] = [value];
  const n = Number(value);
  if (value.trim() !== '' && Number.isFinite(n) && String(n) === value) out.push(n);
  if (value === 'true') out.push(true);
  if (value === 'false') out.push(false);
  return out;
}

/** Native dot-notation path is only safe for a plain single-segment key. */
function isNativeKey(key: string): boolean {
  return key !== '' && !key.includes('.') && !key.startsWith('$');
}

function filterValues(f: MetadataFilter): string[] {
  return f.op === 'in' || f.op === 'not_in' ? (f.values ?? []) : [f.value ?? ''];
}

/** Native clause for a plain key. Arrays never equal a scalar, so they are excluded from positive matches. */
function nativeClause(root: MgJsonRoot, f: MetadataFilter): Document {
  const field = `${root}.${f.key}`;
  const positive = (): Document => ({ [field]: { $in: filterValues(f).flatMap(textCandidates), $not: { $type: 'array' } } });
  switch (f.op) {
    case 'equals':
    case 'in':
      return positive();
    case 'not_equals':
    case 'not_in':
      // $nor of the positive clause also keeps logs without the key; an explicit
      // include_missing: false additionally requires the key to be present.
      return f.include_missing === false ? { [field]: { $exists: true }, $nor: [positive()] } : { $nor: [positive()] };
    case 'exists':
      return { [field]: { $exists: true } };
    case 'not_exists':
      return { [field]: { $exists: false } };
    case 'contains':
      return exprClause(root, f);
  }
}

/** `$expr` clause over the resolved value's text (dotted keys, `$` keys, contains). */
function exprClause(root: MgJsonRoot, f: MetadataFilter): Document {
  const resolved = resolvedValueExpr(root, f.key);
  const text = scalarTextExpr(resolved);
  const positive = (): Document =>
    f.op === 'in' || f.op === 'not_in' ? { $in: [text, f.values ?? []] } : { $eq: [text, f.value ?? ''] };
  switch (f.op) {
    case 'equals':
    case 'in':
      return { $expr: positive() };
    case 'not_equals':
    case 'not_in': {
      const negated = { $not: [positive()] };
      return { $expr: f.include_missing === false ? { $and: [resolvesExpr(resolved), negated] } : negated };
    }
    case 'exists':
      return { $expr: resolvesExpr(resolved) };
    case 'not_exists':
      return { $expr: { $not: [resolvesExpr(resolved)] } };
    case 'contains':
      // $regexMatch is false for a null input, so values without text never match.
      return { $expr: { $regexMatch: { input: text, regex: escapeRegex(f.value ?? ''), options: 'i' } } };
  }
}

/** One filter clause per metadata/attribute filter, for the caller's `$and` list. */
export function compileJsonFilters(filters: MetadataFilter[], root: MgJsonRoot): Document[] {
  rootRef(root);
  return filters.map((f) => (isNativeKey(f.key) ? nativeClause(root, f) : exprClause(root, f)));
}
