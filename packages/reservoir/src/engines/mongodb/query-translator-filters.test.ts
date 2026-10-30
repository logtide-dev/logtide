import { describe, it, expect } from 'vitest';
import { MongoDBQueryTranslator } from './query-translator.js';
import type { MetadataFilter } from '../../core/types.js';

const translator = new MongoDBQueryTranslator();

const base = {
  projectId: '00000000-0000-0000-0000-000000000001',
  from: new Date('2026-01-01T00:00:00Z'),
  to: new Date('2026-01-02T00:00:00Z'),
};

const envProd: MetadataFilter = { key: 'env', op: 'equals', value: 'prod', include_missing: false };

function cursorFor(time: Date, id: string): string {
  return Buffer.from(`${time.toISOString()},${id}`).toString('base64');
}

type Filter = Record<string, unknown>;
const andOf = (f: Filter): Filter[] => (f.$and as Filter[] | undefined) ?? [];

describe('MongoDBQueryTranslator.buildLogFilter', () => {
  it('cursor and metadata clauses coexist', () => {
    const cursorTime = new Date('2026-01-01T12:00:00Z');
    const filter = translator.translateQuery({ ...base, cursor: cursorFor(cursorTime, 'id-1'), metadataFilters: [envProd] }).query as Filter;
    expect(filter.$or).toBeUndefined();
    const and = andOf(filter);
    expect(and).toContainEqual({ $or: [{ time: { $lt: cursorTime } }, { time: cursorTime, id: { $lt: 'id-1' } }] });
    expect(and.some((c) => Object.keys(c).some((k) => k.startsWith('metadata.env')))).toBe(true);
  });

  it('include and exclude on one field coexist', () => {
    const filter = translator.buildLogFilter({ ...base, service: ['api', 'worker'], exclude: { service: ['worker'] } });
    expect(filter.service).toEqual({ $in: ['api', 'worker'] });
    expect(andOf(filter)).toContainEqual({ service: { $nin: ['worker'] } });
  });

  it('exclude.level is a $nin clause', () => {
    const filter = translator.buildLogFilter({ ...base, level: 'error', exclude: { level: ['debug', 'info'] } });
    expect(filter.level).toBe('error');
    expect(andOf(filter)).toContainEqual({ level: { $nin: ['debug', 'info'] } });
  });

  it('exclude.hostname keeps logs without hostname', () => {
    const filter = translator.buildLogFilter({ ...base, exclude: { hostname: ['web-1'] } });
    // A bare $nin also matches documents without the field.
    expect(andOf(filter)).toContainEqual({ 'metadata.hostname': { $nin: ['web-1'] } });
    expect(JSON.stringify(filter)).not.toContain('$exists');
  });

  it('include and exclude on hostname coexist', () => {
    const filter = translator.buildLogFilter({ ...base, hostname: ['web-1', 'web-2'], exclude: { hostname: ['web-2'] } });
    expect(filter['metadata.hostname']).toEqual({ $in: ['web-1', 'web-2'] });
    expect(andOf(filter)).toContainEqual({ 'metadata.hostname': { $nin: ['web-2'] } });
  });

  it('spanId filters span_id', () => {
    expect(translator.buildLogFilter({ ...base, spanId: 'span-9' }).span_id).toBe('span-9');
    expect((translator.translateQuery({ ...base, spanId: 'span-9' }).query as Filter).span_id).toBe('span-9');
    expect((translator.translateCount({ ...base, spanId: 'span-9' }).query as Filter).span_id).toBe('span-9');
  });

  it('empty exclude arrays add nothing', () => {
    const plain = translator.buildLogFilter(base);
    expect(translator.buildLogFilter({ ...base, exclude: { service: [], level: [], hostname: [] } })).toEqual(plain);
    expect(translator.buildLogFilter({ ...base, exclude: {} })).toEqual(plain);
    expect(plain.$and).toBeUndefined();
  });

  it('query and count share one filter', () => {
    const params = {
      ...base,
      service: 'api',
      level: ['error' as const],
      hostname: 'web-1',
      traceId: 't-1',
      sessionId: 's-1',
      spanId: 'span-1',
      metadataFilters: [envProd],
      exclude: { service: ['worker'], level: ['debug' as const], hostname: ['web-9'] },
    };
    expect(translator.translateQuery(params).query).toEqual(translator.translateCount(params).query);
    expect(translator.translateCount(params).query).toEqual(translator.buildLogFilter(params));
  });

  it('never assigns $or at the top level', () => {
    const filter = translator.translateQuery({ ...base, cursor: cursorFor(new Date('2026-01-01T01:00:00Z'), 'x'), sortOrder: 'asc' }).query as Filter;
    expect(filter.$or).toBeUndefined();
    expect(andOf(filter)).toHaveLength(1);
  });
});

describe('MongoDBQueryTranslator topValues and distinct', () => {
  it('topValues and distinct honour hostname', () => {
    const top = translator.translateTopValues({ ...base, field: 'service', hostname: 'h1' });
    expect((top.query as Filter)['metadata.hostname']).toBe('h1');
    const distinct = translator.translateDistinct({ ...base, field: 'service', hostname: ['h1', 'h2'] });
    expect((distinct.query as Filter)['metadata.hostname']).toEqual({ $in: ['h1', 'h2'] });
  });

  it('topValues without hostname adds no hostname filter', () => {
    const top = translator.translateTopValues({ ...base, field: 'service' });
    expect(top.query as Filter).not.toHaveProperty('metadata.hostname');
  });
});
