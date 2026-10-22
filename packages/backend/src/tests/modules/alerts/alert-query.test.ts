import { describe, it, expect } from 'vitest';
import { parseLogQuery, type LogLevel, type MetadataFilter } from '@logtide/shared';
import { compileLogSearch, mergeCompiledSearch } from '@logtide/reservoir';
import {
  compileAlertQuery,
  filterToReservoirParams,
  normalizeAlertQuery,
  type AlertLogFilter,
} from '../../../modules/alerts/alert-query.js';

type Input = Parameters<typeof compileAlertQuery>[0];

function c(o: Partial<Input> = {}) {
  return compileAlertQuery({ query: null, level: ['error'], service: null, metadataFilters: [], ...o });
}

function ok(r: ReturnType<typeof compileAlertQuery>): AlertLogFilter {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.message} at ${r.error.position}`);
  return r.filter;
}

describe('compileAlertQuery', () => {
  it('returns the legacy filter when query is null', () => {
    const r = compileAlertQuery({ query: null, level: ['error'], service: 'api', metadataFilters: [] });
    expect(r).toEqual({ ok: true, filter: { level: ['error'], service: ['api', 'unknown'], metadataFilters: [] } });
  });

  it('keeps the rule metadata filters without a query', () => {
    const rule: MetadataFilter[] = [{ key: 'env', op: 'equals', value: 'prod' }];
    expect(ok(c({ metadataFilters: rule })).metadataFilters).toEqual(rule);
  });

  it('delegates to the shared compiler', () => {
    const q = 'timeout -"health check" service:api -host:db1 user.id:42';
    const level: LogLevel[] = ['error', 'critical'];
    const parsed = parseLogQuery(q);
    if (!parsed.ok) throw new Error('fixture query must parse');
    const base = { level, metadataFilters: [] as MetadataFilter[] };
    const expected = filterToReservoirParams(
      mergeCompiledSearch(base, compileLogSearch(parsed.query)) as AlertLogFilter
    );

    const filter = ok(c({ query: q, level }));
    expect(filter).toEqual(expected);
    // sanity: the merge really carried every part of the query
    expect(filter.textQuery?.all).toEqual([{ kind: 'word', value: 'timeout' }]);
    expect(filter.textQuery?.none).toEqual([{ kind: 'phrase', value: 'health check' }]);
    expect(filter.service).toEqual(['api']);
    expect(filter.exclude).toEqual({ hostname: ['db1'] });
    expect(filter.metadataFilters?.map((f) => f.key)).toEqual(['user.id']);
  });

  it('intersects level clauses with the rule levels', () => {
    expect(ok(c({ level: ['error', 'critical'], query: 'level:error' })).level).toEqual(['error']);
  });

  it('keeps negated levels in exclude', () => {
    expect(ok(c({ level: ['warn', 'error'], query: '-level:warn' })).exclude).toEqual({ level: ['warn'] });
  });

  it('a contradicting level clause matches nothing instead of failing', () => {
    expect(ok(c({ level: ['error'], query: 'timeout level:info' })).matchNothing).toBe(true);
  });

  it('a contradicting service clause matches nothing', () => {
    expect(ok(c({ service: 'api', query: 'service:worker' })).matchNothing).toBe(true);
  });

  it('intersects service clauses with the legacy rule service list', () => {
    expect(ok(c({ service: 'api', query: 'service:(api OR web)' })).service).toEqual(['api']);
  });

  it('appends query metadata filters after the rule filters', () => {
    const rule: MetadataFilter[] = [{ key: 'a', op: 'equals', value: 'x' }];
    const filter = ok(c({ metadataFilters: rule, query: 'b:1' }));
    expect(filter.metadataFilters?.map((f) => f.key)).toEqual(['a', 'b']);
    expect(filter.metadataFilters?.[0]).toEqual(rule[0]);
  });

  it('does not mutate the rule inputs', () => {
    const level: LogLevel[] = ['error', 'critical'];
    const rule: MetadataFilter[] = [{ key: 'a', op: 'equals', value: 'x' }];
    c({ level, metadataFilters: rule, query: 'level:error b:1' });
    expect(level).toEqual(['error', 'critical']);
    expect(rule).toHaveLength(1);
  });

  it('returns the parser error and position unchanged', () => {
    const parsed = parseLogQuery('(a b)');
    expect(parsed.ok).toBe(false);
    expect(c({ query: '(a b)' })).toEqual({ ok: false, error: parsed.ok ? null : parsed.error });
  });

  it('parser rejections reach the caller (level:fatal, trace:(a OR b), host:*)', () => {
    for (const q of ['level:fatal', 'timeout trace:(a OR b)', 'host:*']) {
      const r = c({ query: q });
      expect(r.ok, q).toBe(false);
      if (!r.ok) {
        expect(typeof r.error.message).toBe('string');
        expect(typeof r.error.position).toBe('number');
      }
    }
  });

  it('treats a blank query like no query', () => {
    expect(c({ query: '   ' })).toEqual(c({ query: null }));
  });
});

describe('filterToReservoirParams', () => {
  it('omits empty keys', () => {
    expect(Object.keys(filterToReservoirParams(ok(c({ query: null, service: null }))))).toEqual(['level']);
  });

  it('passes matchNothing through', () => {
    expect(filterToReservoirParams(ok(c({ query: 'level:info' }))).matchNothing).toBe(true);
  });

  it('drops an empty exclude object and empty text query parts', () => {
    const out = filterToReservoirParams({
      level: ['error'],
      exclude: {},
      textQuery: { all: [], anyOf: [], none: [] },
      metadataFilters: [],
      service: undefined,
    });
    expect(out).toEqual({ level: ['error'] });
    expect(Object.keys(out)).toEqual(['level']);
  });
});

describe('normalizeAlertQuery', () => {
  it('trims and turns blank strings into null', () => {
    expect(normalizeAlertQuery('  timeout  ')).toBe('timeout');
    expect(normalizeAlertQuery('   ')).toBeNull();
    expect(normalizeAlertQuery('')).toBeNull();
    expect(normalizeAlertQuery(null)).toBeNull();
    expect(normalizeAlertQuery(undefined)).toBeNull();
  });
});
