import { describe, it, expect } from 'vitest';
import { parseLogQuery } from '@logtide/shared';
import type { MetadataFilter } from '@logtide/shared';
import { compileLogSearch, mergeCompiledSearch } from '@logtide/reservoir';
import {
  buildLogFilter,
  LogQueryError,
  LOG_QUERY_MAX_LENGTH,
  MAX_METADATA_FILTERS,
} from '../../../modules/query/build-log-filter.js';

function parsed(q: string) {
  const result = parseLogQuery(q);
  if (!result.ok) throw new Error(`fixture does not parse: ${q}`);
  return result.query;
}

function thrown(fn: () => unknown): LogQueryError {
  try {
    fn();
  } catch (err) {
    if (err instanceof LogQueryError) return err;
    throw err;
  }
  throw new Error('expected a LogQueryError');
}

describe('buildLogFilter', () => {
  it('1 treats a blank q as no query', () => {
    const built = buildLogFilter({ q: '   ' });
    expect(built.filter.textQuery).toBeUndefined();
    expect(built.query.fields).toEqual([]);
    expect(built.query.text).toEqual({ all: [], anyOf: [], none: [] });
    expect(built.filter.matchNothing).toBeUndefined();
  });

  it('1b treats a missing q as no query', () => {
    const built = buildLogFilter({});
    expect(built.filter).toEqual({});
    expect(built.query.fields).toEqual([]);
  });

  it('2 delegates the mapping to the shared compiler', () => {
    const q = 'timeout "connection refused" -debug service:api -host:web-2 region:eu';
    const built = buildLogFilter({ q });
    const query = parsed(q);
    expect(built.query).toEqual(query);
    expect(built.filter).toEqual(mergeCompiledSearch({}, compileLogSearch(query)));
    expect(built.filter.service).toEqual(['api']);
    expect(built.filter.exclude).toEqual({ hostname: ['web-2'] });
  });

  it('3 keeps substring mode as one phrase', () => {
    const built = buildLogFilter({ q: 'level:error foo', searchMode: 'substring' });
    expect(built.filter.textQuery?.all).toEqual([{ kind: 'phrase', value: 'level:error foo' }]);
    expect(built.filter.level).toBeUndefined();
    expect(built.query.fields).toEqual([]);
  });

  it('4 intersects legacy params with q', () => {
    const built = buildLogFilter({ level: ['error', 'warn'], q: 'level:error' });
    expect(built.filter.level).toEqual(['error']);
    expect(built.filter.matchNothing).toBeUndefined();
  });

  it('4b accepts single legacy values', () => {
    const built = buildLogFilter({ service: 'api', level: 'error', hostname: 'web-1', traceId: 't', sessionId: 's' });
    expect(built.filter).toEqual({ service: ['api'], level: ['error'], hostname: ['web-1'], traceId: 't', sessionId: 's' });
  });

  it('5 turns a contradiction into matchNothing instead of an error', () => {
    const built = buildLogFilter({ service: 'api', q: 'service:worker' });
    expect(built.filter.matchNothing).toBe(true);
  });

  it('6 keeps the parser position on parse errors', () => {
    for (const q of ['(timeout', 'timeout level:loud']) {
      const result = parseLogQuery(q);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      const err = thrown(() => buildLogFilter({ q }));
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe(result.error.message);
      expect(err.position).toBe(result.error.position);
    }
    expect(thrown(() => buildLogFilter({ q: 'timeout level:loud' })).position).toBe(8);
  });

  it('7 rejects a q longer than 2,000 chars', () => {
    expect(LOG_QUERY_MAX_LENGTH).toBe(2000);
    expect(() => buildLogFilter({ q: 'a'.repeat(2000) })).not.toThrow();
    const err = thrown(() => buildLogFilter({ q: 'a'.repeat(2001) }));
    expect(err.message).toBe('Queries can be at most 2,000 characters');
    expect(err.position).toBe(2000);
  });

  it('7b applies the length limit in substring mode too', () => {
    expect(() => buildLogFilter({ q: 'a'.repeat(2001), searchMode: 'substring' })).toThrow(LogQueryError);
  });

  it('8 puts legacy metadata filters before the q ones', () => {
    const legacy: MetadataFilter = { key: 'region', op: 'equals', value: 'eu', include_missing: false };
    const built = buildLogFilter({ metadata_filters: [legacy], q: 'env:prod' });
    expect(built.filter.metadataFilters).toEqual([
      { key: 'region', op: 'equals', value: 'eu', include_missing: false },
      { key: 'env', op: 'equals', value: 'prod', include_missing: false },
    ]);
  });

  it('9 caps the merged metadata filters', () => {
    expect(MAX_METADATA_FILTERS).toBe(10);
    const legacy: MetadataFilter[] = Array.from({ length: 9 }, (_, i) => ({
      key: `k${i}`,
      op: 'exists',
      include_missing: false,
    }));
    const err = thrown(() => buildLogFilter({ metadata_filters: legacy, q: 'a:1 b:2' }));
    expect(err.message).toBe('At most 10 metadata filters are allowed per query');
    expect(err.position).toBe(0);
    expect(() => buildLogFilter({ metadata_filters: legacy, q: 'a:1' })).not.toThrow();
  });

  it('10 keeps colon tokens as free text', () => {
    const built = buildLogFilter({ q: '127.0.0.1:5432 https://example.com/a Error: x' });
    expect(built.query.fields).toEqual([]);
    expect(built.filter.metadataFilters).toBeUndefined();
    const values = (built.filter.textQuery?.all ?? []).map((t) => t.value);
    expect(values).toEqual(expect.arrayContaining(['127.0.0.1:5432', 'https://example.com/a', 'Error:']));
  });
});
