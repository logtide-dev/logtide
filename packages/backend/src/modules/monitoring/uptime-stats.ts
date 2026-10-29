import { sql } from 'kysely';
import { db } from '../../database/index.js';

/**
 * Uptime windows, response-time series and outages of one monitor.
 *
 * 24 h and 7 d read raw monitor_results (retention is 30 days); 30 d and 90 d
 * read the daily aggregate monitor_uptime_daily, whose buckets are UTC days.
 * Every query carries organization_id and monitor_id.
 */

export type UptimeWindowKey = '24h' | '7d' | '30d' | '90d';
export type ResponseTimeRange = '24h' | '7d' | '30d';

export interface UptimeWindow {
  uptimePct: number | null;
  totalChecks: number;
}

export interface UptimeSummary {
  windows: Record<UptimeWindowKey, UptimeWindow>;
}

export interface ResponseTimePoint {
  time: string;
  avgMs: number | null;
  p95Ms: number | null;
  failures: number;
}

export interface ResponseTimes {
  bucketSeconds: number;
  points: ResponseTimePoint[];
}

export interface Outage {
  incidentId: string;
  title: string;
  status: string;
  severity: string;
  startedAt: string;
  resolvedAt: string | null;
  durationSeconds: number | null;
}

export const RESPONSE_TIME_RANGES: Record<ResponseTimeRange, { windowMs: number; bucketSeconds: number }> = {
  '24h': { windowMs: 24 * 3600_000, bucketSeconds: 300 },
  '7d': { windowMs: 7 * 24 * 3600_000, bucketSeconds: 3600 },
  '30d': { windowMs: 30 * 24 * 3600_000, bucketSeconds: 21600 },
};

const DAY_MS = 24 * 3600_000;

function toWindow(total: number, up: number): UptimeWindow {
  if (total <= 0) return { uptimePct: null, totalChecks: 0 };
  return { uptimePct: Math.round((up / total) * 10000) / 100, totalChecks: total };
}

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function monitorExists(monitorId: string, organizationId: string): Promise<boolean> {
  const row = await db
    .selectFrom('monitors')
    .select('id')
    .where('id', '=', monitorId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();
  return !!row;
}

/** Returns null when the monitor does not exist in the organization. */
export async function getUptimeSummary(
  monitorId: string,
  organizationId: string
): Promise<UptimeSummary | null> {
  if (!(await monitorExists(monitorId, organizationId))) return null;

  const now = new Date();
  const since24h = new Date(now.getTime() - DAY_MS);
  const since7d = new Date(now.getTime() - 7 * DAY_MS);
  // N UTC days including today
  const since30d = new Date(utcDayStart(now).getTime() - 29 * DAY_MS);
  const since90d = new Date(utcDayStart(now).getTime() - 89 * DAY_MS);

  const [raw, daily] = await Promise.all([
    sql<{ total_24h: string; up_24h: string; total_7d: string; up_7d: string }>`
      SELECT
        COUNT(*) FILTER (WHERE time >= ${since24h}) AS total_24h,
        COUNT(*) FILTER (WHERE time >= ${since24h} AND status = 'up') AS up_24h,
        COUNT(*) AS total_7d,
        COUNT(*) FILTER (WHERE status = 'up') AS up_7d
      FROM monitor_results
      WHERE monitor_id = ${monitorId}
        AND organization_id = ${organizationId}
        AND time >= ${since7d}
    `.execute(db),
    sql<{ total_30d: string | null; up_30d: string | null; total_90d: string | null; up_90d: string | null }>`
      SELECT
        SUM(total_checks) FILTER (WHERE bucket >= ${since30d}) AS total_30d,
        SUM(successful_checks) FILTER (WHERE bucket >= ${since30d}) AS up_30d,
        SUM(total_checks) AS total_90d,
        SUM(successful_checks) AS up_90d
      FROM monitor_uptime_daily
      WHERE monitor_id = ${monitorId}
        AND organization_id = ${organizationId}
        AND bucket >= ${since90d}
    `.execute(db),
  ]);

  const r = raw.rows[0];
  const d = daily.rows[0];
  const n = (v: string | number | null | undefined) => Number(v ?? 0);

  return {
    windows: {
      '24h': toWindow(n(r?.total_24h), n(r?.up_24h)),
      '7d': toWindow(n(r?.total_7d), n(r?.up_7d)),
      '30d': toWindow(n(d?.total_30d), n(d?.up_30d)),
      '90d': toWindow(n(d?.total_90d), n(d?.up_90d)),
    },
  };
}

/** Returns null when the monitor does not exist in the organization. */
export async function getResponseTimes(
  monitorId: string,
  organizationId: string,
  range: ResponseTimeRange
): Promise<ResponseTimes | null> {
  if (!(await monitorExists(monitorId, organizationId))) return null;

  const { windowMs, bucketSeconds } = RESPONSE_TIME_RANGES[range];
  const since = new Date(Date.now() - windowMs);
  const bucketInterval = `${bucketSeconds} seconds`;

  const rows = await sql<{
    bucket: Date;
    avg_ms: string | null;
    p95_ms: string | null;
    failures: string;
  }>`
    SELECT
      time_bucket(${bucketInterval}::interval, time) AS bucket,
      AVG(response_time_ms) AS avg_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms) AS p95_ms,
      COUNT(*) FILTER (WHERE status = 'down') AS failures
    FROM monitor_results
    WHERE monitor_id = ${monitorId}
      AND organization_id = ${organizationId}
      AND time >= ${since}
    GROUP BY bucket
    ORDER BY bucket ASC
  `.execute(db);

  return {
    bucketSeconds,
    points: rows.rows.map((row) => ({
      time: new Date(row.bucket).toISOString(),
      avgMs: row.avg_ms === null ? null : Math.round(Number(row.avg_ms)),
      p95Ms: row.p95_ms === null ? null : Math.round(Number(row.p95_ms)),
      failures: Number(row.failures),
    })),
  };
}

/** Outages are the monitor's shared incidents (source monitor). Null when the monitor is not in the organization. */
export async function getOutages(
  monitorId: string,
  organizationId: string,
  limit: number
): Promise<{ outages: Outage[] } | null> {
  if (!(await monitorExists(monitorId, organizationId))) return null;

  const rows = await db
    .selectFrom('incidents')
    .select(['id', 'title', 'status', 'severity', 'created_at', 'resolved_at'])
    .where('organization_id', '=', organizationId)
    .where('source', '=', 'monitor')
    .where('monitor_id', '=', monitorId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();

  return {
    outages: rows.map((row) => {
      const startedAt = new Date(row.created_at as Date);
      const resolvedAt = row.resolved_at ? new Date(row.resolved_at as Date) : null;
      return {
        incidentId: row.id,
        title: row.title,
        status: row.status,
        severity: row.severity,
        startedAt: startedAt.toISOString(),
        resolvedAt: resolvedAt ? resolvedAt.toISOString() : null,
        durationSeconds: resolvedAt
          ? Math.max(0, Math.round((resolvedAt.getTime() - startedAt.getTime()) / 1000))
          : null,
      };
    }),
  };
}
