// ============================================================================
// compileLogSearch and mergeCompiledSearch (spec 6.4, plan D6)
// ============================================================================
// The only path from a parsed log query to reservoir params, shared by the
// logs API (W3) and alert rules (W8). `compileLogSearch` is total for every
// query `parseLogQuery` accepts; `mergeCompiledSearch` narrows an existing
// set of typed params with it and never widens them.

import { LOG_LEVELS, isValidFieldKey } from '@logtide/shared';
import type { FieldClause, LogSearchQuery, TextTerm } from '@logtide/shared';
import { legacySearchToTextQuery, isEmptyTextQuery } from './text-query.js';
import type { LogExclude, LogLevel, MetadataFilter, QueryParams, TextQuery } from './types.js';

/** Reservoir params produced by one parsed log query. */
export type CompiledLogSearch = Pick<
  QueryParams,
  'textQuery' | 'exclude' | 'metadataFilters' | 'level' | 'service' | 'hostname' | 'traceId' | 'sessionId' | 'spanId'
>;

type ListField = 'level' | 'service' | 'hostname';
type SingleField = 'traceId' | 'sessionId' | 'spanId';

const LIST_FIELDS: readonly ListField[] = ['level', 'service', 'hostname'];
const SINGLE_FIELDS: readonly SingleField[] = ['traceId', 'sessionId', 'spanId'];
const EXCLUDE_FIELDS: readonly (keyof LogExclude)[] = ['service', 'level', 'hostname'];
const LEVELS = new Set<string>(LOG_LEVELS);
const NEGATIVE_OPS = new Set<FieldClause['op']>(['not_equals', 'not_in', 'not_exists']);

/** Order-preserving union without duplicates. */
function union(...lists: readonly string[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const value of list) {
      if (!seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
    }
  }
  return out;
}

const copyTerm = (t: TextTerm): TextTerm => ({ kind: t.kind, value: t.value });

function copyText(text: TextQuery): TextQuery {
  return {
    all: text.all.map(copyTerm),
    anyOf: text.anyOf.map((group) => group.map(copyTerm)),
    none: text.none.map(copyTerm),
  };
}

function clauseValues(clause: FieldClause, where: string): string[] {
  if (clause.op === 'in' || clause.op === 'not_in') {
    if (!Array.isArray(clause.values) || clause.values.length === 0) {
      throw new RangeError(`${where}: ${clause.op} needs at least one value`);
    }
    return clause.values;
  }
  const value = (clause as { value?: unknown }).value;
  if (typeof value !== 'string') throw new RangeError(`${where}: ${clause.op} needs a value`);
  return [value];
}

function checkLevels(values: string[]): LogLevel[] {
  for (const value of values) {
    if (!LEVELS.has(value)) throw new RangeError(`Unknown level ${JSON.stringify(value)}`);
  }
  return values as LogLevel[];
}

function compileMetadata(key: string, clause: FieldClause): MetadataFilter {
  if (!isValidFieldKey(key)) throw new RangeError(`Invalid metadata key ${JSON.stringify(key)}`);
  const include_missing = NEGATIVE_OPS.has(clause.op);
  switch (clause.op) {
    case 'equals':
    case 'not_equals':
    case 'contains':
      return { key, op: clause.op, value: clauseValues(clause, `metadata ${key}`)[0], include_missing };
    case 'in':
    case 'not_in':
      return { key, op: clause.op, values: union(clauseValues(clause, `metadata ${key}`)), include_missing };
    case 'exists':
    case 'not_exists':
      return { key, op: clause.op, include_missing };
    default:
      throw new RangeError(`Unknown operator ${String((clause as { op: unknown }).op)} on metadata ${key}`);
  }
}

/**
 * Compiles a parsed query (plan D6): built-in equals/in become typed params
 * (arrays for level, service and hostname, strings for trace, session and
 * span), built-in not_equals/not_in become `exclude` (unioned), metadata
 * clauses become `MetadataFilter`s with `include_missing` true only for the
 * negative operators, and free text becomes `textQuery`. Empty parts are
 * omitted. Hand-built queries the parser would reject (unsupported built-in
 * operators, a second positive clause on a built-in, unknown levels, missing
 * values, invalid keys) throw RangeError.
 */
export function compileLogSearch(query: LogSearchQuery): CompiledLogSearch {
  const out: CompiledLogSearch = {};
  const exclude: Record<ListField, string[]> = { level: [], service: [], hostname: [] };
  const metadataFilters: MetadataFilter[] = [];
  const positive = new Set<string>();

  for (const clause of query.fields) {
    if ('metadata' in clause.field) {
      metadataFilters.push(compileMetadata(clause.field.metadata, clause));
      continue;
    }
    const builtin = clause.field.builtin;
    if ((LIST_FIELDS as readonly string[]).includes(builtin)) {
      const name = builtin as ListField;
      if (clause.op !== 'equals' && clause.op !== 'in' && clause.op !== 'not_equals' && clause.op !== 'not_in') {
        throw new RangeError(`The ${name} field does not support the ${clause.op} operator`);
      }
      let values = clauseValues(clause, name);
      if (name === 'level') values = checkLevels(values);
      if (clause.op === 'not_equals' || clause.op === 'not_in') {
        exclude[name] = union(exclude[name], values);
        continue;
      }
      if (positive.has(name)) throw new RangeError(`The ${name} field is already filtered`);
      positive.add(name);
      (out as Record<string, unknown>)[name] = union(values);
    } else if ((SINGLE_FIELDS as readonly string[]).includes(builtin)) {
      const name = builtin as SingleField;
      if (clause.op !== 'equals') throw new RangeError(`The ${name} field supports only equals`);
      if (positive.has(name)) throw new RangeError(`The ${name} field is already filtered`);
      positive.add(name);
      out[name] = clauseValues(clause, name)[0];
    } else {
      throw new RangeError(`Unknown built-in field ${String(builtin)}`);
    }
  }

  const excluded: LogExclude = {};
  for (const name of EXCLUDE_FIELDS) {
    if (exclude[name].length > 0) (excluded as Record<string, string[]>)[name] = exclude[name];
  }
  if (Object.keys(excluded).length > 0) out.exclude = excluded;
  if (metadataFilters.length > 0) out.metadataFilters = metadataFilters;
  if (!isEmptyTextQuery(query.text)) out.textQuery = copyText(query.text);
  return out;
}

const asList = (v: string | string[]): string[] => (Array.isArray(v) ? v : [v]);

/**
 * Narrows `base` with a compiled search (plan D6). Level, service and
 * hostname become the intersection of both value lists (base order); trace,
 * session and span ids must agree; an empty intersection or a disagreement
 * omits that field and sets `matchNothing`. `exclude` lists are unioned,
 * `metadataFilters` and `textQuery` parts concatenated (base first), and a
 * base legacy `search`/`searchMode` is folded into `textQuery` and dropped
 * (a base `textQuery` wins over it, as in the client). Every other base field
 * passes through; `base` is never mutated.
 */
export function mergeCompiledSearch(base: Partial<QueryParams>, compiled: CompiledLogSearch): Partial<QueryParams> {
  const out: Partial<QueryParams> = { ...base };
  let matchNothing = base.matchNothing === true;

  for (const name of LIST_FIELDS) {
    const b = base[name];
    const c = compiled[name];
    if (c === undefined) continue;
    if (b === undefined) {
      (out as Record<string, unknown>)[name] = union(asList(c));
      continue;
    }
    const allowed = new Set(asList(c));
    const both = union(asList(b)).filter((v) => allowed.has(v));
    if (both.length === 0) {
      delete out[name];
      matchNothing = true;
    } else {
      (out as Record<string, unknown>)[name] = both;
    }
  }

  for (const name of SINGLE_FIELDS) {
    const b = base[name];
    const c = compiled[name];
    if (c === undefined) continue;
    if (b === undefined || b === c) {
      out[name] = c;
    } else {
      delete out[name];
      matchNothing = true;
    }
  }

  if (base.exclude !== undefined || compiled.exclude !== undefined) {
    const exclude: LogExclude = {};
    for (const name of EXCLUDE_FIELDS) {
      const b = base.exclude?.[name];
      const c = compiled.exclude?.[name];
      if (b === undefined && c === undefined) continue;
      (exclude as Record<string, string[]>)[name] = union(b ?? [], c ?? []);
    }
    out.exclude = exclude;
  }

  if (base.metadataFilters !== undefined || compiled.metadataFilters !== undefined) {
    out.metadataFilters = [...(base.metadataFilters ?? []), ...(compiled.metadataFilters ?? [])];
  }

  const baseText = base.textQuery ?? legacySearchToTextQuery(base.search, base.searchMode);
  delete out.search;
  delete out.searchMode;
  delete out.textQuery;
  const parts = [baseText, compiled.textQuery].filter((t): t is TextQuery => t !== undefined);
  if (parts.length > 0) {
    const text: TextQuery = {
      all: parts.flatMap((t) => t.all.map(copyTerm)),
      anyOf: parts.flatMap((t) => t.anyOf.map((group) => group.map(copyTerm))),
      none: parts.flatMap((t) => t.none.map(copyTerm)),
    };
    if (!isEmptyTextQuery(text)) out.textQuery = text;
  }

  if (matchNothing) out.matchNothing = true;
  return out;
}
