import { describe, it, expect, vi } from 'vitest';
import type { ClickHouseClient } from '@clickhouse/client';
import { assembleHistogram } from './log-analytics.js';
import { ClickHouseQueryTranslator } from './query-translator.js';
import { ClickHouseEngine } from './clickhouse-engine.js';
import type { LogHistogramParams } from '../../core/types.js';

const at = (iso: string) => new Date(iso);
const ms = (iso: string) => String(at(iso).getTime());

function stubEngine(rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async (_args: unknown) => ({ json: async () => rows }));
  const client = { query } as unknown as ClickHouseClient;
  const engine = new ClickHouseEngine(
    { host: 'localhost', port: 18123, database: 'unused', username: 'default', password: '' },
    { client, skipInitialize: true },
  );
  return { engine, query };
}

const base: LogHistogramParams = {
  projectId: '00000000-0000-0000-0000-000000000001',
  from: at('2026-01-01T10:00:00.000Z'),
  to: at('2026-01-01T10:15:00.000Z'),
  bucketSeconds: 300,
};

describe('clickhouse histogram', () => {
  it('zero-fills missing buckets and keeps only non-zero levels', () => {
    const result = assembleHistogram(base, [
      { bucket_ms: ms('2026-01-01T10:00:00.000Z'), level: 'info', n: '2' },
      { bucket_ms: ms('2026-01-01T10:00:00.000Z'), level: 'error', n: '1' },
      { bucket_ms: ms('2026-01-01T10:10:00.000Z'), level: 'warn', n: '4' },
      { bucket_ms: ms('2026-01-01T10:10:00.000Z'), level: 'debug', n: '0' },
    ]);
    expect(result.bucketSeconds).toBe(300);
    expect(result.buckets.map((b) => b.time.toISOString())).toEqual([
      '2026-01-01T10:00:00.000Z',
      '2026-01-01T10:05:00.000Z',
      '2026-01-01T10:10:00.000Z',
      '2026-01-01T10:15:00.000Z',
    ]);
    expect(result.buckets[0]).toMatchObject({ total: 3, byLevel: { info: 2, error: 1 } });
    expect(result.buckets[1]).toMatchObject({ total: 0, byLevel: {} });
    expect(result.buckets[2]).toMatchObject({ total: 4, byLevel: { warn: 4 } });
    expect(result.buckets[3]).toMatchObject({ total: 0, byLevel: {} });
  });

  it('aligns buckets to the unix epoch', () => {
    const result = assembleHistogram({ ...base, from: at('2026-01-01T10:07:30.000Z') }, []);
    expect(result.buckets[0].time.toISOString()).toBe('2026-01-01T10:05:00.000Z');
  });

  it('drops the bucket at an aligned exclusive end', () => {
    const result = assembleHistogram({ ...base, toExclusive: true }, []);
    expect(result.buckets.at(-1)?.time.toISOString()).toBe('2026-01-01T10:10:00.000Z');
    expect(result.buckets).toHaveLength(3);
  });

  it('rejects a bucket size that is not a positive integer before querying', async () => {
    const { engine, query } = stubEngine();
    await expect(engine.histogram({ ...base, bucketSeconds: 0 })).rejects.toBeInstanceOf(RangeError);
    await expect(engine.histogram({ ...base, bucketSeconds: 1.5 })).rejects.toBeInstanceOf(RangeError);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects too many buckets with a readable message', async () => {
    const { engine, query } = stubEngine();
    const params = { ...base, from: new Date(0), to: new Date((1001 * 60 - 1) * 1000), bucketSeconds: 60 };
    await expect(engine.histogram(params)).rejects.toThrow(
      'A histogram can have at most 1,000 buckets (this range needs 1,001 buckets of 60 s)',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('histogram reuses the log filter', () => {
    const translator = new ClickHouseQueryTranslator('logs');
    const native = translator.translateHistogram({
      ...base,
      textQuery: { all: [{ kind: 'word', value: 'timeout' }], anyOf: [], none: [] },
      exclude: { service: ['worker'] },
    });
    const query = native.query as string;
    expect(query).toContain('intDiv(toUnixTimestamp64Milli(time), {p_bms:Int64}) * {p_bms:Int64} AS bucket_ms');
    expect(query).toContain(' PREWHERE project_id = {p_project_id:String} AND time >= {p_from:DateTime64(3)}');
    expect(query).toContain('lowerUTF8(message) LIKE {p_tq0:String}');
    expect(query).toContain('service NOT IN {p_ex_service:Array(String)}');
    expect(query).toContain('GROUP BY bucket_ms, level');
    expect((native.parameters as Record<string, unknown>[])[0].p_bms).toBe(300_000);
  });

  it('the engine maps grouped rows to zero-filled buckets', async () => {
    const { engine, query } = stubEngine([
      { bucket_ms: ms('2026-01-01T10:05:00.000Z'), level: 'error', n: '7' },
    ]);
    const result = await engine.histogram(base);
    expect(query).toHaveBeenCalledTimes(1);
    expect(result.buckets.map((b) => b.total)).toEqual([0, 7, 0, 0]);
    expect(result.buckets[1].byLevel).toEqual({ error: 7 });
  });

  it('the engine derives the text query from legacy search', async () => {
    const { engine, query } = stubEngine();
    await engine.histogram({ ...base, search: 'timeout' });
    const args = query.mock.calls[0][0] as { query: string; query_params: Record<string, unknown> };
    expect(args.query).toContain('match(message, {p_tq1:String})');
    expect(args.query_params.p_tq0).toBe('%timeout%');
  });
});
