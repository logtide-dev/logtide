/**
 * Read models behind the projects table and the project page header:
 * batched 24h volume stats, health summary/detail and the summary tiles.
 * Log volume goes through the reservoir so every storage engine works.
 */

import { sql } from 'kysely';
import type {
  ProjectHealthCheckKey,
  ProjectHealthIssue,
  ProjectHealthSeverity,
  ProjectHealthStatus,
} from '@logtide/shared';
import { PROJECT_HEALTH_SILENT_DEFAULT_MINUTES } from '@logtide/shared';
import { db } from '../../database/connection.js';
import { reservoir } from '../../database/reservoir.js';
import { projectsService } from './service.js';
import {
  getProjectHealthSettings,
  isMuted,
  listIssues,
  listOpenByOrg,
  toApiIssue,
} from '../project-health/index.js';
import { getSettingsForProjects } from '../project-health/settings.js';
import { tracesService } from '../traces/service.js';
import { ExceptionService } from '../exceptions/service.js';
import { getUptimeSummary } from '../monitoring/uptime-stats.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const STATS_CONCURRENCY = 5;
const STATS_CACHE_TTL_MS = 60_000;
const STATS_CACHE_MAX = 500;

export interface ProjectStats {
  logs24h: number;
  errors24h: number;
  hourly: number[];
  openIncidents: number;
}

export interface ProjectHealthSummaryEntry {
  status: ProjectHealthStatus;
  openIssues: Array<{ checkKey: ProjectHealthCheckKey; severity: ProjectHealthSeverity; muted: boolean }>;
}

const statsCache = new Map<string, { at: number; value: Record<string, ProjectStats> }>();

export function clearProjectStatsCache(): void {
  statsCache.clear();
}

const toTime = (v: Date | string | null): number | null =>
  v === null ? null : (v instanceof Date ? v : new Date(v)).getTime();

function lastEventOf(p: {
  has_logs_at: Date | string | null;
  has_traces_at: Date | string | null;
  has_metrics_at: Date | string | null;
}): Date | null {
  const times = [p.has_logs_at, p.has_traces_at, p.has_metrics_at]
    .map(toTime)
    .filter((t): t is number => t !== null);
  return times.length ? new Date(Math.max(...times)) : null;
}

/**
 * no_data if never received; else worst unmuted open severity; else inactive
 * when nothing arrived within the silent threshold; else healthy.
 */
export function computeHealthStatus(
  lastEventAt: Date | string | null,
  openIssues: Array<{ severity: ProjectHealthSeverity; muted: boolean }>,
  idle?: { silentMinutes: number; now: Date }
): ProjectHealthStatus {
  if (lastEventAt === null) return 'no_data';
  const unmuted = openIssues.filter((i) => !i.muted);
  if (unmuted.some((i) => i.severity === 'critical')) return 'critical';
  if (unmuted.some((i) => i.severity === 'warning')) return 'warning';
  if (idle) {
    const last = (lastEventAt instanceof Date ? lastEventAt : new Date(lastEventAt)).getTime();
    if (idle.now.getTime() - last > idle.silentMinutes * 60_000) return 'inactive';
  }
  return 'healthy';
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function projectVolume(
  projectId: string,
  now: Date
): Promise<{ logs24h: number; errors24h: number; hourly: number[] }> {
  // 24 hour-aligned buckets ending with the current (partial) hour.
  const currentHour = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  const firstHour = currentHour - 23 * HOUR_MS;
  const result = await reservoir.aggregate({
    projectId,
    from: new Date(firstHour),
    to: now,
    interval: '1h',
  });
  const hourly = new Array<number>(24).fill(0);
  let errors = 0;
  for (const b of result.timeseries) {
    const idx = Math.floor((new Date(b.bucket).getTime() - firstHour) / HOUR_MS);
    if (idx < 0 || idx > 23) continue;
    hourly[idx] += b.total;
    errors += (b.byLevel?.error ?? 0) + (b.byLevel?.critical ?? 0);
  }
  return { logs24h: hourly.reduce((a, c) => a + c, 0), errors24h: errors, hourly };
}

async function openIncidentsByProject(organizationId: string): Promise<Map<string, number>> {
  const rows = await db
    .selectFrom('incidents')
    .select(['project_id', (eb) => eb.fn.countAll().as('count')])
    .where('organization_id', '=', organizationId)
    .where('status', 'in', ['open', 'investigating'])
    .where('project_id', 'is not', null)
    .groupBy('project_id')
    .execute();
  const map = new Map<string, number>();
  for (const r of rows) if (r.project_id) map.set(r.project_id, Number(r.count));
  return map;
}

/** Per-project 24h volume for an organization. A failing project has no entry. */
export async function getOrganizationProjectStats(
  organizationId: string
): Promise<Record<string, ProjectStats>> {
  const cached = statsCache.get(organizationId);
  if (cached && Date.now() - cached.at < STATS_CACHE_TTL_MS) return cached.value;

  const projects = await db
    .selectFrom('projects')
    .select('id')
    .where('organization_id', '=', organizationId)
    .where('deleted_at', 'is', null)
    .execute();

  const now = new Date();
  let incidents = new Map<string, number>();
  try {
    incidents = await openIncidentsByProject(organizationId);
  } catch {
    // incidents are a secondary column: show 0 rather than failing the call
  }

  const entries = await mapLimit(projects, STATS_CONCURRENCY, async (p) => {
    try {
      const vol = await projectVolume(p.id, now);
      return [p.id, { ...vol, openIncidents: incidents.get(p.id) ?? 0 }] as const;
    } catch {
      return null;
    }
  });

  const value: Record<string, ProjectStats> = {};
  for (const e of entries) if (e) value[e[0]] = e[1];

  if (statsCache.size >= STATS_CACHE_MAX) statsCache.clear();
  statsCache.set(organizationId, { at: Date.now(), value });
  return value;
}

/** Health status and open issues per non-deleted project of an organization. */
export async function getOrganizationHealthSummary(
  organizationId: string
): Promise<Record<string, ProjectHealthSummaryEntry>> {
  const [projects, issues] = await Promise.all([
    db
      .selectFrom('projects')
      .select(['id', 'has_logs_at', 'has_traces_at', 'has_metrics_at'])
      .where('organization_id', '=', organizationId)
      .where('deleted_at', 'is', null)
      .execute(),
    listOpenByOrg(organizationId),
  ]);
  const settings = await getSettingsForProjects(projects.map((p) => p.id));
  const now = new Date();

  const result: Record<string, ProjectHealthSummaryEntry> = {};
  for (const p of projects) {
    const projectSettings = settings.get(p.id);
    const mutes = projectSettings?.mutes ?? {};
    const silentMinutes = projectSettings?.silentMinutes ?? PROJECT_HEALTH_SILENT_DEFAULT_MINUTES;
    const openIssues = issues
      .filter((i) => i.projectId === p.id)
      .map((i) => ({
        checkKey: i.checkKey,
        severity: i.severity,
        muted: isMuted(mutes[i.checkKey], now),
      }));
    result[p.id] = {
      status: computeHealthStatus(lastEventOf(p), openIssues, { silentMinutes, now }),
      openIssues,
    };
  }
  return result;
}

export interface ProjectHealthDetail {
  status: ProjectHealthStatus;
  lastEventAt: string | null;
  issues: ProjectHealthIssue[];
  checks: {
    receiving: boolean;
    piiRejected24h: number;
    skew: Awaited<ReturnType<typeof projectsService.getIngestionHealth>>['skew'];
    revokedKey24h: number;
  };
  settings: { silentMinutes: number; healthChannelIds: string[] };
}

export async function getProjectHealthDetail(
  organizationId: string,
  projectId: string
): Promise<ProjectHealthDetail> {
  const now = new Date();
  const since = new Date(now.getTime() - DAY_MS);
  // Issues, settings and the project row are the core of the answer; skew and
  // the counters are secondary and degrade (null / 0) instead of failing it.
  const [project, issueRows, settings, ingestion, counters] = await Promise.all([
    db
      .selectFrom('projects')
      .select(['has_logs_at', 'has_traces_at', 'has_metrics_at'])
      .where('id', '=', projectId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirstOrThrow(),
    listIssues(organizationId, projectId),
    getProjectHealthSettings(organizationId, projectId),
    settle(() => projectsService.getIngestionHealth(organizationId, projectId)),
    settle(
      () =>
        sql<{ pii: number | string; revoked: number | string }>`
      SELECT
        COALESCE(SUM(quantity) FILTER (WHERE type = 'ingestion.pii_rejected'), 0)::float8 AS pii,
        COALESCE(SUM(quantity) FILTER (WHERE type = 'ingestion.revoked_key'), 0)::float8 AS revoked
      FROM metering_events
      WHERE organization_id = ${organizationId}
        AND project_id = ${projectId}
        AND type IN ('ingestion.pii_rejected', 'ingestion.revoked_key')
        AND time >= ${since}
    `.execute(db)
    ),
  ]);

  const lastEvent = lastEventOf(project);
  const issues = issueRows.map((r) => toApiIssue(r, settings.mutes));
  const openIssues = issueRows
    .filter((r) => r.resolvedAt === null)
    .map((r) => ({ severity: r.severity, muted: isMuted(settings.mutes[r.checkKey], now) }));
  const row = counters?.rows[0];

  return {
    status: computeHealthStatus(lastEvent, openIssues, { silentMinutes: settings.silentMinutes, now }),
    lastEventAt: lastEvent ? lastEvent.toISOString() : null,
    issues,
    checks: {
      receiving:
        lastEvent !== null && now.getTime() - lastEvent.getTime() <= settings.silentMinutes * 60_000,
      piiRejected24h: Number(row?.pii ?? 0),
      skew: ingestion?.skew ?? { logs: null, spans: null, metrics: null },
      revokedKey24h: Number(row?.revoked ?? 0),
    },
    settings: { silentMinutes: settings.silentMinutes, healthChannelIds: settings.healthChannelIds },
  };
}

async function settle<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export interface ProjectSummary {
  logs24h: number | null;
  openErrorGroups: number | null;
  tracesP95Ms: number | null;
  uptime30dPct: number | null;
  monitorCount: number | null;
  openIncidents: number | null;
}

const exceptionService = new ExceptionService(db);

/** Header tiles of the project page. Each field fails independently to null. */
export async function getProjectSummary(
  organizationId: string,
  projectId: string
): Promise<ProjectSummary> {
  const now = new Date();
  const from = new Date(now.getTime() - DAY_MS);

  const monitors = await settle(() =>
    db
      .selectFrom('monitors')
      .select('id')
      .where('organization_id', '=', organizationId)
      .where('project_id', '=', projectId)
      .execute()
  );

  const [logs24h, openErrorGroups, tracesP95Ms, uptime30dPct, openIncidents] = await Promise.all([
    settle(async () => (await reservoir.aggregate({ projectId, from, to: now, interval: '1h' })).total),
    settle(
      async () =>
        (await exceptionService.getErrorGroups({ organizationId, projectId, status: 'open', limit: 1 }))
          .total
    ),
    settle(async () => {
      const stats = await tracesService.getStats(projectId, from, now);
      return stats.total_traces > 0 ? stats.p95_duration_ms : null;
    }),
    settle(async () => {
      if (!monitors || monitors.length === 0) return null;
      let weighted = 0;
      let checks = 0;
      const summaries = await mapLimit(monitors, STATS_CONCURRENCY, (m) =>
        getUptimeSummary(m.id, organizationId)
      );
      for (const summary of summaries) {
        const w = summary?.windows['30d'];
        if (w && w.uptimePct !== null && w.totalChecks > 0) {
          weighted += w.uptimePct * w.totalChecks;
          checks += w.totalChecks;
        }
      }
      return checks > 0 ? Math.round((weighted / checks) * 100) / 100 : null;
    }),
    settle(async () => {
      const row = await db
        .selectFrom('incidents')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('organization_id', '=', organizationId)
        .where('project_id', '=', projectId)
        .where('status', 'in', ['open', 'investigating'])
        .executeTakeFirst();
      return Number(row?.count ?? 0);
    }),
  ]);

  return {
    logs24h,
    openErrorGroups,
    tracesP95Ms,
    uptime30dPct,
    monitorCount: monitors ? monitors.length : null,
    openIncidents,
  };
}
