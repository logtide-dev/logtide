import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MetadataFilter } from '@logtide/shared';

// Pure unit tests for BaselineCalculatorService. The Kysely db (continuous
// aggregate fast path on TimescaleDB) and the reservoir (count / aggregate,
// used for metadata filters and non-Timescale engines) are both mocked, so the
// baseline math and engine routing can be asserted without a database.

const state = vi.hoisted(() => ({
    wheres: [] as any[][],
    first: undefined as any,
    rows: [] as any[],
    engine: 'timescale' as string,
}));

const reservoirMock = vi.hoisted(() => ({
    count: vi.fn(),
    aggregate: vi.fn(),
    getEngineType: vi.fn(),
}));

vi.mock('../../../database/connection.js', () => {
    const builder: any = {
        select: () => builder,
        where: (...args: any[]) => {
            state.wheres.push(args);
            return builder;
        },
        groupBy: () => builder,
        orderBy: () => builder,
        executeTakeFirst: async () => state.first,
        execute: async () => state.rows,
    };
    return { db: { selectFrom: () => builder } };
});

vi.mock('../../../database/reservoir.js', () => ({ reservoir: reservoirMock }));

import { BaselineCalculatorService } from '../../../modules/alerts/baseline-calculator.js';

const NOW = new Date('2026-10-19T14:37:12.345Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const CURRENT_HOUR = new Date('2026-10-19T14:00:00.000Z').getTime();
const PROJECTS = ['p1', 'p2'];
const FILTERS: MetadataFilter[] = [{ key: 'env', op: 'equals', value: 'prod' } as any];

function serviceWheres() {
    return state.wheres.filter((w) => w[0] === 'service');
}

function bucket(byLevel?: Record<string, number>) {
    return { bucket: new Date(), total: 0, byLevel };
}

describe('BaselineCalculatorService (unit)', () => {
    let service: BaselineCalculatorService;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        state.wheres = [];
        state.first = undefined;
        state.rows = [];
        reservoirMock.count.mockReset();
        reservoirMock.aggregate.mockReset();
        reservoirMock.getEngineType.mockReset();
        reservoirMock.getEngineType.mockImplementation(() => state.engine);
        state.engine = 'timescale';
        service = new BaselineCalculatorService();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('calculate dispatch', () => {
        it('returns null without projects', async () => {
            expect(await service.calculate('rolling_7d_avg', [], ['error'], null)).toBeNull();
            expect(reservoirMock.getEngineType).not.toHaveBeenCalled();
        });

        it('returns null for an unknown method', async () => {
            expect(await service.calculate('bogus' as any, PROJECTS, ['error'], null)).toBeNull();
        });
    });

    describe('getCurrentHourlyRate', () => {
        it('returns 0 without projects', async () => {
            expect(await service.getCurrentHourlyRate([], ['error'], null)).toBe(0);
            expect(reservoirMock.count).not.toHaveBeenCalled();
        });

        it('counts the last hour with service and metadata filters', async () => {
            reservoirMock.count.mockResolvedValue({ count: 17 });
            const rate = await service.getCurrentHourlyRate(PROJECTS, ['error', 'critical'], 'api', FILTERS);
            expect(rate).toBe(17);
            const args = reservoirMock.count.mock.calls[0][0];
            expect(args.projectId).toEqual(PROJECTS);
            expect(args.level).toEqual(['error', 'critical']);
            expect(args.service).toEqual(['api', 'unknown']);
            expect(args.metadataFilters).toEqual(FILTERS);
            expect(args.from.getTime()).toBe(NOW.getTime() - HOUR + 1);
            expect(args.to.getTime()).toBe(NOW.getTime());
        });

        it('omits service and empty metadata filters', async () => {
            reservoirMock.count.mockResolvedValue({ count: 0 });
            expect(await service.getCurrentHourlyRate(PROJECTS, ['error'], null, [])).toBe(0);
            const args = reservoirMock.count.mock.calls[0][0];
            expect('service' in args).toBe(false);
            expect('metadataFilters' in args).toBe(false);
        });
    });

    describe.each([
        ['same_time_yesterday', DAY],
        ['same_day_last_week', 7 * DAY],
    ] as const)('%s', (method, offset) => {
        const bucketStart = CURRENT_HOUR - offset;

        it('counts the single hour bucket via the reservoir when metadata filters are set', async () => {
            reservoirMock.count.mockResolvedValue({ count: 9 });
            const result = await service.calculate(method, PROJECTS, ['error'], 'api', FILTERS);
            expect(result).toEqual({ value: 9, samplesUsed: 1 });
            const args = reservoirMock.count.mock.calls[0][0];
            expect(args.from.getTime()).toBe(bucketStart);
            expect(args.to.getTime()).toBe(bucketStart + HOUR);
            expect(args.service).toEqual(['api', 'unknown']);
            expect(args.metadataFilters).toEqual(FILTERS);
            expect(reservoirMock.getEngineType).not.toHaveBeenCalled();
        });

        it('returns null when the filtered bucket is empty', async () => {
            reservoirMock.count.mockResolvedValue({ count: 0 });
            expect(await service.calculate(method, PROJECTS, ['error'], null, FILTERS)).toBeNull();
            expect('service' in reservoirMock.count.mock.calls[0][0]).toBe(false);
        });

        it('reads the continuous aggregate on TimescaleDB', async () => {
            state.first = { total: '42', sample_count: '3' };
            const result = await service.calculate(method, PROJECTS, ['error'], 'api');
            expect(result).toEqual({ value: 42, samplesUsed: 3 });
            const bucketWheres = state.wheres.filter((w) => w[0] === 'bucket');
            expect(bucketWheres[0][1]).toBe('>=');
            expect(bucketWheres[0][2].getTime()).toBe(bucketStart);
            expect(bucketWheres[1][1]).toBe('<');
            expect(bucketWheres[1][2].getTime()).toBe(bucketStart + HOUR);
            expect(serviceWheres()).toEqual([['service', '=', 'api']]);
        });

        it('returns null on TimescaleDB when no samples exist', async () => {
            state.first = { total: null, sample_count: '0' };
            expect(await service.calculate(method, PROJECTS, ['error'], null)).toBeNull();
            expect(serviceWheres()).toEqual([]);
        });

        it('returns null on TimescaleDB when the query yields no row', async () => {
            state.first = undefined;
            expect(await service.calculate(method, PROJECTS, ['error'], null)).toBeNull();
        });

        it('sums only the requested levels from reservoir.aggregate on other engines', async () => {
            state.engine = 'clickhouse';
            reservoirMock.aggregate.mockResolvedValue({
                timeseries: [
                    bucket({ error: 4, critical: 1, info: 100 }),
                    bucket({ info: 50 }),
                    bucket(undefined),
                    bucket({ error: 2 }),
                ],
            });
            const result = await service.calculate(method, PROJECTS, ['error', 'critical'], 'api');
            expect(result).toEqual({ value: 7, samplesUsed: 2 });
            const args = reservoirMock.aggregate.mock.calls[0][0];
            expect(args.interval).toBe('1h');
            expect(args.service).toEqual(['api', 'unknown']);
            expect(args.from.getTime()).toBe(bucketStart);
        });

        it('returns null on other engines when no requested-level logs exist', async () => {
            state.engine = 'mongodb';
            reservoirMock.aggregate.mockResolvedValue({ timeseries: [bucket({ info: 3 })] });
            expect(await service.calculate(method, PROJECTS, ['error'], null)).toBeNull();
            expect(reservoirMock.aggregate.mock.calls[0][0].service).toBeUndefined();
        });
    });

    describe('rolling_7d_avg', () => {
        const expectedBuckets = Array.from({ length: 7 }, (_, i) => CURRENT_HOUR - (i + 1) * DAY);

        it('averages the non-empty filtered buckets across the last 7 days', async () => {
            const counts = [10, 0, 20, 0, 0, 30, 0];
            reservoirMock.count.mockImplementation(async (args: any) => {
                const idx = expectedBuckets.indexOf(args.from.getTime());
                return { count: counts[idx] };
            });
            const result = await service.calculate('rolling_7d_avg', PROJECTS, ['error'], null, FILTERS);
            expect(result).toEqual({ value: 20, samplesUsed: 3 });
            expect(reservoirMock.count).toHaveBeenCalledTimes(7);
            const froms = reservoirMock.count.mock.calls.map((c) => c[0].from.getTime());
            expect(froms).toEqual(expectedBuckets);
            for (const c of reservoirMock.count.mock.calls) {
                expect(c[0].to.getTime() - c[0].from.getTime()).toBe(HOUR);
            }
        });

        it('rounds the filtered average', async () => {
            const counts = [1, 2, 0, 0, 0, 0, 0];
            reservoirMock.count.mockImplementation(async (args: any) => ({
                count: counts[expectedBuckets.indexOf(args.from.getTime())],
            }));
            const result = await service.calculate('rolling_7d_avg', PROJECTS, ['error'], 'api', FILTERS);
            expect(result).toEqual({ value: 2, samplesUsed: 2 });
        });

        it('returns null when every filtered bucket is empty', async () => {
            reservoirMock.count.mockResolvedValue({ count: 0 });
            expect(await service.calculate('rolling_7d_avg', PROJECTS, ['error'], null, FILTERS)).toBeNull();
        });

        it('divides the aggregate sum by the distinct bucket count on TimescaleDB', async () => {
            state.first = { total: '100', bucket_count: '3' };
            const result = await service.calculate('rolling_7d_avg', PROJECTS, ['error'], 'api');
            expect(result).toEqual({ value: 33, samplesUsed: 3 });
            const inBuckets = state.wheres.find((w) => w[0] === 'bucket');
            expect(inBuckets![1]).toBe('in');
            expect(inBuckets![2].map((d: Date) => d.getTime())).toEqual(expectedBuckets);
            expect(serviceWheres()).toEqual([['service', '=', 'api']]);
        });

        it('returns null on TimescaleDB when no bucket has data', async () => {
            state.first = { total: null, bucket_count: '0' };
            expect(await service.calculate('rolling_7d_avg', PROJECTS, ['error'], null)).toBeNull();
            expect(serviceWheres()).toEqual([]);
        });

        it('returns null on TimescaleDB when the query yields no row', async () => {
            state.first = undefined;
            expect(await service.calculate('rolling_7d_avg', PROJECTS, ['error'], null)).toBeNull();
        });

        it('aggregates each bucket separately on other engines', async () => {
            state.engine = 'clickhouse';
            const perBucket: Record<number, any[]> = {
                [expectedBuckets[0]]: [bucket({ error: 5, warn: 99 })],
                [expectedBuckets[1]]: [bucket({ warn: 1 })],
                [expectedBuckets[2]]: [bucket(undefined), bucket({ error: 7, critical: 3 })],
            };
            reservoirMock.aggregate.mockImplementation(async (args: any) => ({
                timeseries: perBucket[args.from.getTime()] ?? [],
            }));
            const result = await service.calculate('rolling_7d_avg', PROJECTS, ['error', 'critical'], 'api');
            // (5 + 10) / 2 non-empty buckets
            expect(result).toEqual({ value: 8, samplesUsed: 2 });
            expect(reservoirMock.aggregate).toHaveBeenCalledTimes(7);
            expect(reservoirMock.aggregate.mock.calls[0][0].service).toEqual(['api', 'unknown']);
        });

        it('returns null on other engines when every bucket is empty', async () => {
            state.engine = 'clickhouse';
            reservoirMock.aggregate.mockResolvedValue({ timeseries: [] });
            expect(await service.calculate('rolling_7d_avg', PROJECTS, ['error'], null)).toBeNull();
            expect(reservoirMock.aggregate.mock.calls[0][0].service).toBeUndefined();
        });
    });

    describe('percentile_p95', () => {
        it('takes the p95 of non-empty filtered hourly buckets over 168 hours', async () => {
            // 20 non-empty hours with counts 1..20; ceil(20 * 0.95) - 1 = 18 -> 19
            reservoirMock.count.mockImplementation(async (args: any) => {
                const hoursAgo = (CURRENT_HOUR - args.from.getTime()) / HOUR;
                return { count: hoursAgo <= 20 ? 21 - hoursAgo : 0 };
            });
            const result = await service.calculate('percentile_p95', PROJECTS, ['error'], 'api', FILTERS);
            expect(result).toEqual({ value: 19, samplesUsed: 20 });
            expect(reservoirMock.count).toHaveBeenCalledTimes(168);
            const froms = reservoirMock.count.mock.calls.map((c) => c[0].from.getTime());
            expect(Math.max(...froms)).toBe(CURRENT_HOUR - HOUR);
            expect(Math.min(...froms)).toBe(CURRENT_HOUR - 168 * HOUR);
        });

        it('returns null when every filtered hour is empty', async () => {
            reservoirMock.count.mockResolvedValue({ count: 0 });
            expect(await service.calculate('percentile_p95', PROJECTS, ['error'], null, FILTERS)).toBeNull();
        });

        it('returns the single sample when only one filtered hour has data', async () => {
            reservoirMock.count.mockImplementation(async (args: any) => ({
                count: args.from.getTime() === CURRENT_HOUR - 5 * HOUR ? 42 : 0,
            }));
            expect(await service.calculate('percentile_p95', PROJECTS, ['error'], null, FILTERS))
                .toEqual({ value: 42, samplesUsed: 1 });
        });

        it('sorts hourly totals from the aggregate on TimescaleDB', async () => {
            state.rows = Array.from({ length: 10 }, (_, i) => ({ bucket: new Date(), hourly_total: String((i * 7) % 10 + 1) }));
            const result = await service.calculate('percentile_p95', PROJECTS, ['error'], 'api');
            // values 1..10 shuffled; ceil(10 * 0.95) - 1 = 9 -> 10
            expect(result).toEqual({ value: 10, samplesUsed: 10 });
            const from = state.wheres.find((w) => w[0] === 'bucket');
            expect(from![1]).toBe('>=');
            expect(from![2].getTime()).toBe(NOW.getTime() - 7 * DAY);
            expect(serviceWheres()).toEqual([['service', '=', 'api']]);
        });

        it('returns null on TimescaleDB with no rows', async () => {
            state.rows = [];
            expect(await service.calculate('percentile_p95', PROJECTS, ['error'], null)).toBeNull();
            expect(serviceWheres()).toEqual([]);
        });

        it('computes p95 from requested levels only on other engines', async () => {
            state.engine = 'clickhouse';
            reservoirMock.aggregate.mockResolvedValue({
                timeseries: [
                    bucket({ error: 3 }),
                    bucket({ info: 1000 }),
                    bucket(undefined),
                    bucket({ error: 1, critical: 1 }),
                    bucket({ critical: 50 }),
                ],
            });
            const result = await service.calculate('percentile_p95', PROJECTS, ['error', 'critical'], 'api');
            // non-empty sorted counts [2, 3, 50]; ceil(3 * 0.95) - 1 = 2 -> 50
            expect(result).toEqual({ value: 50, samplesUsed: 3 });
            const args = reservoirMock.aggregate.mock.calls[0][0];
            expect(args.service).toEqual(['api', 'unknown']);
            expect(args.from.getTime()).toBe(NOW.getTime() - 7 * DAY);
            expect(args.to.getTime()).toBe(NOW.getTime());
        });

        it('returns null on other engines with an empty timeseries', async () => {
            state.engine = 'clickhouse';
            reservoirMock.aggregate.mockResolvedValue({ timeseries: [] });
            expect(await service.calculate('percentile_p95', PROJECTS, ['error'], null)).toBeNull();
            expect(reservoirMock.aggregate.mock.calls[0][0].service).toBeUndefined();
        });

        it('returns null on other engines when no bucket has requested-level logs', async () => {
            state.engine = 'clickhouse';
            reservoirMock.aggregate.mockResolvedValue({ timeseries: [bucket({ info: 4 }), bucket(undefined)] });
            expect(await service.calculate('percentile_p95', PROJECTS, ['error'], null)).toBeNull();
        });
    });
});
