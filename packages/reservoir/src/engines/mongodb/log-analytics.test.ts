import { describe, it, expect, vi } from 'vitest';
import { Long, type Document } from 'mongodb';
import { assembleHistogram, histogramPipeline } from './log-analytics.js';
import { MongoDBQueryTranslator } from './query-translator.js';
import { MongoDBEngine } from './mongodb-engine.js';
import type { LogHistogramParams, StorageConfig } from '../../core/types.js';

const at = (iso: string) => new Date(`2026-01-05T${iso}Z`);
const row = (iso: string, level: string, n: number) => ({ _id: { b: at(iso).getTime(), level }, n });

const config: StorageConfig = { host: 'localhost', port: 27017, database: 'unused', username: '', password: '' };
const PROJECT = '00000000-0000-0000-0000-000000000001';

describe('assembleHistogram', () => {
  it('zero-fills missing buckets and keeps only non-zero levels', () => {
    const result = assembleHistogram(
      { from: at('10:00:00'), to: at('10:15:00'), bucketSeconds: 300 },
      [row('10:00:00', 'info', 2), row('10:00:00', 'error', 1), row('10:10:00', 'warn', 4), row('10:10:00', 'debug', 0)],
    );
    expect(result.bucketSeconds).toBe(300);
    expect(result.buckets.map((b) => b.time.toISOString())).toEqual([
      '2026-01-05T10:00:00.000Z',
      '2026-01-05T10:05:00.000Z',
      '2026-01-05T10:10:00.000Z',
      '2026-01-05T10:15:00.000Z',
    ]);
    expect(result.buckets[0]).toMatchObject({ total: 3, byLevel: { info: 2, error: 1 } });
    expect(result.buckets[1]).toMatchObject({ total: 0, byLevel: {} });
    expect(result.buckets[2]).toMatchObject({ total: 4, byLevel: { warn: 4 } });
    expect(result.buckets[3]).toMatchObject({ total: 0, byLevel: {} });
  });

  it('aligns buckets to the unix epoch', () => {
    const result = assembleHistogram({ from: at('10:07:30'), to: at('10:12:00'), bucketSeconds: 300 }, []);
    expect(result.buckets[0].time.toISOString()).toBe('2026-01-05T10:05:00.000Z');
  });

  it('drops the bucket at an aligned exclusive end', () => {
    const result = assembleHistogram({ from: at('10:00:00'), to: at('10:15:00'), toExclusive: true, bucketSeconds: 300 }, []);
    expect(result.buckets.map((b) => b.time.toISOString()).at(-1)).toBe('2026-01-05T10:10:00.000Z');
  });

  it('accepts bucket starts and counts returned as BSON longs', () => {
    const result = assembleHistogram(
      { from: at('10:00:00'), to: at('10:05:00'), bucketSeconds: 300 },
      [{ _id: { b: Long.fromNumber(at('10:05:00').getTime()), level: 'error' }, n: Long.fromNumber(7) }],
    );
    expect(result.buckets[1]).toMatchObject({ total: 7, byLevel: { error: 7 } });
  });
});

describe('MongoDBEngine.histogram validation', () => {
  const engine = new MongoDBEngine(config);
  const base: LogHistogramParams = { projectId: PROJECT, from: at('10:00:00'), to: at('11:00:00'), bucketSeconds: 60 };

  it('rejects a bucket size that is not a positive integer', async () => {
    await expect(engine.histogram({ ...base, bucketSeconds: 0 })).rejects.toBeInstanceOf(RangeError);
    await expect(engine.histogram({ ...base, bucketSeconds: 1.5 })).rejects.toBeInstanceOf(RangeError);
  });

  it('rejects too many buckets with a readable message', async () => {
    const tooMany = { ...base, from: new Date(0), to: new Date((1001 * 60 - 1) * 1000) };
    await expect(engine.histogram(tooMany)).rejects.toBeInstanceOf(RangeError);
    await expect(engine.histogram(tooMany)).rejects.toThrow('this range needs 1,001 buckets of 60 s');
  });
});

describe('MongoDBEngine.histogram query', () => {
  it('aggregates the pipeline on the logs collection with allowDiskUse', async () => {
    const calls: { pipeline: Document[]; options: Record<string, unknown> }[] = [];
    const collection = {
      aggregate: vi.fn((pipeline: Document[], options: Record<string, unknown>) => {
        calls.push({ pipeline, options });
        return { toArray: async () => [row('10:05:00', 'error', 2)] };
      }),
    };
    const db = { collection: vi.fn(() => collection) };
    const engine = new MongoDBEngine(config, { db: db as never, skipInitialize: true });
    const result = await engine.histogram({ projectId: PROJECT, from: at('10:00:00'), to: at('10:10:00'), bucketSeconds: 300, service: 'api' });
    expect(db.collection).toHaveBeenCalledWith('logs');
    expect(calls).toHaveLength(1);
    expect(calls[0].options.allowDiskUse).toBe(true);
    expect(calls[0].pipeline[0]).toMatchObject({ $match: { project_id: PROJECT, service: 'api' } });
    expect(result.buckets.map((b) => b.total)).toEqual([0, 2, 0]);
  });
});

describe('histogramPipeline', () => {
  it('histogram reuses the log filter and epoch-aligned arithmetic', () => {
    const translator = new MongoDBQueryTranslator();
    const filter = translator.buildLogFilter({
      projectId: PROJECT,
      from: at('10:00:00'),
      to: at('11:00:00'),
      textQuery: { all: [{ kind: 'word', value: 'timeout' }], anyOf: [], none: [] },
      exclude: { level: ['debug'] },
    });
    const pipeline = histogramPipeline(filter, 300_000);
    expect(pipeline[0]).toEqual({ $match: filter });
    const match = JSON.stringify(pipeline[0]);
    expect(match).toContain(`"project_id":"${PROJECT}"`);
    expect(match).toContain('"$regex"');
    expect(match).toContain('"$nin":["debug"]');
    const group = JSON.stringify(pipeline[1]);
    expect(group).toContain('"$mod":[{"$toLong":"$time"},300000]');
    expect(group).toContain('"level":"$level"');
    expect(JSON.stringify(pipeline)).not.toContain('$dateTrunc');
  });
});
