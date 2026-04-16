import { db } from '../../database/connection.js';
import { sql } from 'kysely';
import { reservoir } from '../../database/reservoir.js';
import type { LogLevel } from '@logtide/shared';
import type { LogLevel as ReservoirLogLevel } from '@logtide/reservoir';
import type { BaselineType } from '../../database/types.js';

export interface BaselineResult {
  value: number;
  samplesUsed: number;
}

export class BaselineCalculatorService {
  /**
   * Calculate baseline log count for a given method.
   * Uses logs_hourly_stats continuous aggregate for fast queries.
   */
  async calculate(
    method: BaselineType,
    projectIds: string[],
    levels: LogLevel[],
    service: string | null,
  ): Promise<BaselineResult | null> {
    if (projectIds.length === 0) return null;

    switch (method) {
      case 'same_time_yesterday':
        return this.sameTimeYesterday(projectIds, levels, service);
      case 'same_day_last_week':
        return this.sameDayLastWeek(projectIds, levels, service);
      case 'rolling_7d_avg':
        return this.rolling7dAvg(projectIds, levels, service);
      case 'percentile_p95':
        return this.percentileP95(projectIds, levels, service);
      default:
        return null;
    }
  }

  /**
   * Get current hourly log rate (last hour from reservoir)
   */
  async getCurrentHourlyRate(
    projectIds: string[],
    levels: LogLevel[],
    service: string | null,
  ): Promise<number> {
    if (projectIds.length === 0) return 0;

    // Reservoir count: works with any engine
    // Original used time > fromTime (exclusive); add 1ms to simulate exclusive from
    const fromTime = new Date(Date.now() - 60 * 60 * 1000 + 1);
    const result = await reservoir.count({
      projectId: projectIds,
      from: fromTime,
      to: new Date(),
      level: levels as ReservoirLogLevel[],
      ...(service ? { service: [service, 'unknown'] } : {}),
    });

    return result.count;
  }

  /**
   * Same time yesterday: compare to the same hour 24h ago
   */
  private async sameTimeYesterday(
    projectIds: string[],
    levels: LogLevel[],
    service: string | null,
  ): Promise<BaselineResult | null> {
    const now = new Date();
    // Get the hour bucket for 24h ago
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const bucketStart = new Date(yesterday);
    bucketStart.setMinutes(0, 0, 0);
    const bucketEnd = new Date(bucketStart.getTime() + 60 * 60 * 1000);

    const result = await this.queryAggregate(bucketStart, bucketEnd, projectIds, levels, service);
    if (!result || result.samplesUsed === 0) return null;
    return result;
  }

  /**
   * Same day last week: compare to the same hour 7 days ago
   */
  private async sameDayLastWeek(
    projectIds: string[],
    levels: LogLevel[],
    service: string | null,
  ): Promise<BaselineResult | null> {
    const now = new Date();
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const bucketStart = new Date(lastWeek);
    bucketStart.setMinutes(0, 0, 0);
    const bucketEnd = new Date(bucketStart.getTime() + 60 * 60 * 1000);

    const result = await this.queryAggregate(bucketStart, bucketEnd, projectIds, levels, service);
    if (!result || result.samplesUsed === 0) return null;
    return result;
  }

  /**
   * Rolling 7-day average: average of the same hour across the last 7 days.
   * E.g., if it's 14:00 now, average of 14:00-15:00 for each of the last 7 days.
   * Uses logs_hourly_stats on TimescaleDB, reservoir.aggregate() on ClickHouse.
   */
  private async rolling7dAvg(
    projectIds: string[],
    levels: LogLevel[],
    service: string | null,
  ): Promise<BaselineResult | null> {
    const now = new Date();
    const currentHour = new Date(now);
    currentHour.setMinutes(0, 0, 0);

    // Collect the same hour bucket for each of the last 7 days
    const bucketTimes: Date[] = [];
    for (let i = 1; i <= 7; i++) {
      bucketTimes.push(new Date(currentHour.getTime() - i * 24 * 60 * 60 * 1000));
    }

    if (reservoir.getEngineType() === 'timescale') {
      // Fast path: continuous aggregate (TimescaleDB only)
      let query = db
        .selectFrom('logs_hourly_stats')
        .select([
          sql<string>`SUM(log_count)`.as('total'),
          sql<string>`COUNT(DISTINCT bucket)`.as('bucket_count'),
        ])
        .where('project_id', 'in', projectIds)
        .where('level', 'in', levels)
        .where('bucket', 'in', bucketTimes);

      if (service) {
        query = query.where('service', '=', service);
      }

      const result = await query.executeTakeFirst();
      const total = Number(result?.total || 0);
      const bucketCount = Number(result?.bucket_count || 0);

      if (bucketCount === 0) return null;

      return {
        value: Math.round(total / bucketCount),
        samplesUsed: bucketCount,
      };
    }

    // ClickHouse: query each hour bucket individually via reservoir
    let total = 0;
    let bucketCount = 0;

    const results = await Promise.all(
      bucketTimes.map(async (bucketStart) => {
        const bucketEnd = new Date(bucketStart.getTime() + 60 * 60 * 1000);
        const aggResult = await reservoir.aggregate({
          projectId: projectIds,
          from: bucketStart,
          to: bucketEnd,
          interval: '1h',
          service: service ? [service, 'unknown'] : undefined,
        });

        // Sum only the requested levels
        let count = 0;
        for (const b of aggResult.timeseries) {
          if (b.byLevel) {
            for (const level of levels) {
              count += b.byLevel[level as ReservoirLogLevel] || 0;
            }
          }
        }
        return count;
      })
    );

    for (const count of results) {
      if (count > 0) {
        total += count;
        bucketCount++;
      }
    }

    if (bucketCount === 0) return null;

    return {
      value: Math.round(total / bucketCount),
      samplesUsed: bucketCount,
    };
  }

  /**
   * Percentile P95: 95th percentile of hourly log counts over the last 7 days.
   * Uses logs_hourly_stats on TimescaleDB, reservoir.aggregate() on ClickHouse.
   */
  private async percentileP95(
    projectIds: string[],
    levels: LogLevel[],
    service: string | null,
  ): Promise<BaselineResult | null> {
    const fromTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const now = new Date();

    let counts: number[];

    if (reservoir.getEngineType() === 'timescale') {
      // Fast path: continuous aggregate (TimescaleDB only)
      let query = db
        .selectFrom('logs_hourly_stats')
        .select([
          'bucket',
          sql<string>`SUM(log_count)`.as('hourly_total'),
        ])
        .where('bucket', '>=', fromTime)
        .where('project_id', 'in', projectIds)
        .where('level', 'in', levels)
        .groupBy('bucket')
        .orderBy('bucket', 'asc');

      if (service) {
        query = query.where('service', '=', service);
      }

      const results = await query.execute();
      if (results.length === 0) return null;

      counts = results.map(r => Number(r.hourly_total)).sort((a, b) => a - b);
    } else {
      // ClickHouse: aggregate from raw data with 1h interval
      const aggResult = await reservoir.aggregate({
        projectId: projectIds,
        from: fromTime,
        to: now,
        interval: '1h',
        service: service ? [service, 'unknown'] : undefined,
      });

      if (aggResult.timeseries.length === 0) return null;

      // Sum only the requested levels per bucket
      counts = aggResult.timeseries.map((bucket: { byLevel?: Record<string, number> }) => {
        let count = 0;
        if (bucket.byLevel) {
          for (const level of levels) {
            count += bucket.byLevel[level as ReservoirLogLevel] || 0;
          }
        }
        return count;
      }).filter((c: number) => c > 0).sort((a: number, b: number) => a - b);

      if (counts.length === 0) return null;
    }

    const index = Math.min(Math.ceil(counts.length * 0.95) - 1, counts.length - 1);

    return {
      value: counts[index],
      samplesUsed: counts.length,
    };
  }

  /**
   * Query hourly aggregate for a time range and sum the counts.
   * Uses logs_hourly_stats on TimescaleDB, reservoir.aggregate() on ClickHouse.
   */
  private async queryAggregate(
    from: Date,
    to: Date,
    projectIds: string[],
    levels: LogLevel[],
    service: string | null,
  ): Promise<BaselineResult | null> {
    if (reservoir.getEngineType() === 'timescale') {
      // Fast path: continuous aggregate (TimescaleDB only)
      let query = db
        .selectFrom('logs_hourly_stats')
        .select([
          sql<string>`SUM(log_count)`.as('total'),
          sql<string>`COUNT(*)`.as('sample_count'),
        ])
        .where('bucket', '>=', from)
        .where('bucket', '<', to)
        .where('project_id', 'in', projectIds)
        .where('level', 'in', levels);

      if (service) {
        query = query.where('service', '=', service);
      }

      const result = await query.executeTakeFirst();
      const total = Number(result?.total || 0);
      const sampleCount = Number(result?.sample_count || 0);

      return {
        value: total,
        samplesUsed: sampleCount,
      };
    }

    // ClickHouse: aggregate from raw data (fast enough for analytical queries)
    const aggResult = await reservoir.aggregate({
      projectId: projectIds,
      from,
      to,
      interval: '1h',
      service: service ? [service, 'unknown'] : undefined,
    });

    // Filter to only requested levels and sum
    let total = 0;
    let sampleCount = 0;
    for (const bucket of aggResult.timeseries) {
      let bucketCount = 0;
      if (bucket.byLevel) {
        for (const level of levels) {
          bucketCount += bucket.byLevel[level as ReservoirLogLevel] || 0;
        }
      }
      if (bucketCount > 0) {
        total += bucketCount;
        sampleCount++;
      }
    }

    return {
      value: total,
      samplesUsed: sampleCount,
    };
  }
}

export const baselineCalculator = new BaselineCalculatorService();
