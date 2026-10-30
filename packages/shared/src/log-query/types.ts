// ============================================================================
// Log query grammar types (spec 6.3)
// ============================================================================
// Pure, browser-safe types shared by the parser, the in-memory matcher, the
// click-to-filter editors and the reservoir compiler.

/** A free-text term: `word` is a case-insensitive token match, `phrase` a case-insensitive substring. */
export type TextTerm = { kind: 'word' | 'phrase'; value: string };

/** Typed log fields addressable from the query grammar. */
export type BuiltinField = 'level' | 'service' | 'hostname' | 'traceId' | 'sessionId' | 'spanId';

export type FieldRef = { builtin: BuiltinField } | { metadata: string };

export type FieldClause =
  | {
      field: FieldRef;
      op: 'equals' | 'not_equals' | 'contains' | 'exists' | 'not_exists';
      value?: string;
    }
  | { field: FieldRef; op: 'in' | 'not_in'; values: string[] };

export interface LogSearchQuery {
  text: { all: TextTerm[]; anyOf: TextTerm[][]; none: TextTerm[] };
  fields: FieldClause[];
}

/**
 * A highlighted span of the input. Positions are UTF-16 code unit offsets,
 * `start` inclusive, `end` exclusive.
 */
export type QueryToken = {
  kind: 'word' | 'phrase' | 'field' | 'operator' | 'negation' | 'error';
  start: number;
  end: number;
};

export type ParseLogQueryResult =
  | { ok: true; query: LogSearchQuery; tokens: QueryToken[] }
  | { ok: false; error: { message: string; position: number }; tokens: QueryToken[] };

/** The log shape the matcher reads (live tail rows, conformance fixtures). */
export type MatchableLog = {
  message: string;
  level: string;
  service: string;
  hostname?: string | null;
  traceId?: string | null;
  sessionId?: string | null;
  spanId?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** Same limits as `metadataFilterSchema` plus the overall input length. */
export const LOG_QUERY_LIMITS = {
  maxQueryLength: 4096,
  maxMetadataClauses: 10,
  maxListValues: 50,
  maxValueLength: 1000,
  maxKeyLength: 200,
} as const;

/** Canonical grammar key per built-in field (used when building clause text). */
export const BUILTIN_FIELD_KEYS: Record<BuiltinField, string> = {
  level: 'level',
  service: 'service',
  hostname: 'host',
  traceId: 'trace',
  sessionId: 'session',
  spanId: 'span',
};
