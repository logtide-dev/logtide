import { describe, it, expect, afterEach, vi } from 'vitest';
import { sql } from 'kysely';
import { db } from '../../../database/index.js';
import { dashboardService } from '../../../modules/dashboard/service.js';
import { createTestContext, createTestLog } from '../../helpers/factories.js';
import { startOfUtcDay, startOfUtcHour } from '../../../utils/time-buckets.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * The dashboard reads whole buckets from the continuous aggregates and the open
 * bucket from raw data. The split must sit on a bucket boundary: a log near the
 * end of the previous bucket is in the aggregate and must not be read again
 * from the raw tail (the old cutoff was now - 1h / now - 24h).
 *
 * The clock is moved into the past so the buckets read from the aggregate can
 * be materialized by an explicit refresh, whatever other tests refreshed.
 */
describe('DashboardService - aggregate and raw tail split', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('timeseries counts the logs around the hour boundary once', async () => {
        const { organization, project } = await createTestContext();
        const currentHour = new Date(startOfUtcHour(new Date()).getTime() - 2 * HOUR);
        const previousHour = new Date(currentHour.getTime() - HOUR);

        await createTestLog({ projectId: project.id, level: 'info', time: previousHour });
        await createTestLog({ projectId: project.id, level: 'error', time: new Date(currentHour.getTime() - 1000) });
        await createTestLog({ projectId: project.id, level: 'info', time: new Date(currentHour.getTime() + 10 * 60 * 1000) });
        await sql`CALL refresh_continuous_aggregate('logs_hourly_stats', ${new Date(previousHour.getTime() - HOUR)}::timestamptz, ${currentHour}::timestamptz)`.execute(db);

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(currentHour.getTime() + 30 * 60 * 1000));

        const series = await dashboardService.getTimeseries(organization.id, project.id);
        const byTime = new Map(series.map((p) => [new Date(p.time).toISOString(), p]));

        expect(byTime.get(previousHour.toISOString())).toMatchObject({ total: 2, info: 1, error: 1 });
        expect(byTime.get(currentHour.toISOString())).toMatchObject({ total: 1, info: 1 });
        expect(series.reduce((sum, p) => sum + p.total, 0)).toBe(3);
    });

    it('top services count the logs around the day boundary once', async () => {
        const { organization, project } = await createTestContext();
        const today = new Date(startOfUtcDay(new Date()).getTime() - 2 * DAY);

        await createTestLog({ projectId: project.id, service: 'late-yesterday', time: new Date(today.getTime() - 1000) });
        await createTestLog({ projectId: project.id, service: 'this-morning', time: new Date(today.getTime() + HOUR) });
        await sql`CALL refresh_continuous_aggregate('logs_daily_stats', ${new Date(today.getTime() - 2 * DAY)}::timestamptz, ${today}::timestamptz)`.execute(db);

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(today.getTime() + 12 * HOUR));

        const services = await dashboardService.getTopServices(organization.id, 5, project.id);

        expect(services).toEqual(
            expect.arrayContaining([
                { name: 'late-yesterday', count: 1, percentage: 50 },
                { name: 'this-morning', count: 1, percentage: 50 },
            ])
        );
        expect(services).toHaveLength(2);
    });
});

describe('continuous aggregates are real-time (migration 076)', () => {
    it('every aggregate reads the not yet materialized rows', async () => {
        const { rows } = await sql<{ view_name: string; materialized_only: boolean }>`
            SELECT view_name, materialized_only
            FROM timescaledb_information.continuous_aggregates
            WHERE view_schema = current_schema()
            ORDER BY view_name
        `.execute(db);

        expect(rows.map((r) => r.view_name)).toEqual(expect.arrayContaining([
            'logs_hourly_stats', 'logs_daily_stats', 'logs_minute_stats',
            'spans_hourly_stats', 'spans_daily_stats',
            'metrics_hourly_stats', 'metrics_daily_stats',
            'detection_events_hourly_stats', 'detection_events_daily_stats', 'detection_events_rule_stats',
        ]));
        expect(rows.filter((r) => r.materialized_only)).toEqual([]);
    });

    it('hourly aggregates refresh every 10 minutes, daily ones every hour', async () => {
        const { rows } = await sql<{ name: string; schedule_interval: string; end_offset: string }>`
            SELECT hypertable_name AS name,
                   schedule_interval::text AS schedule_interval,
                   (config->>'end_offset') AS end_offset
            FROM timescaledb_information.jobs
            WHERE proc_name = 'policy_refresh_continuous_aggregate'
              AND hypertable_schema = current_schema()
        `.execute(db);
        const policy = new Map(rows.map((r) => [r.name, r]));

        for (const name of ['logs_hourly_stats', 'spans_hourly_stats', 'metrics_hourly_stats', 'detection_events_hourly_stats']) {
            expect(policy.get(name), name).toMatchObject({ schedule_interval: '00:10:00', end_offset: '00:10:00' });
        }
        for (const name of ['logs_daily_stats', 'spans_daily_stats', 'metrics_daily_stats', 'detection_events_daily_stats', 'detection_events_rule_stats']) {
            expect(policy.get(name), name).toMatchObject({ schedule_interval: '01:00:00', end_offset: '01:00:00' });
        }
    });
});
