/**
 * One project health pass over every non-deleted project.
 *
 * 1. Batched inputs: projects (last event from has_*_at), one GROUP BY over
 *    metering_events for PII rejections / revoked keys (60 min) and clock skew
 *    (24 h), settings rows, issue rows.
 * 2. Reconcile each project: open / touch / reopen (15 min flapping guard) /
 *    resolve, clearing `untilResolved` mutes on resolve.
 *    Rollout guard (migration 074): the silent check arms only once a pass has
 *    seen the project receiving data, and issues opened on a project's first
 *    pass are baseline (pre-existing, never notified).
 * 3. Notify per the state machine: an open, unmuted issue with
 *    notified_open_at null sends "opened"; a resolved issue whose open was
 *    notified sends "resolved". Both are claimed with a conditional UPDATE
 *    first, so concurrent passes never send twice.
 */

import { sql } from 'kysely';
import type { ProjectHealthCheckKey } from '@logtide/shared';
import { db } from '../../database/connection.js';
import { computeOpenChecks, type ProjectHealthInputs } from './checks.js';
import {
  REOPEN_WINDOW_MS,
  claimOpenNotification,
  claimResolveNotification,
  loadIssuesForProjects,
  openIssue,
  reopenIssue,
  resolveIssue,
  touchIssue,
  type HealthIssueRow,
} from './repository.js';
import {
  clearUntilResolvedMutes,
  defaultProjectHealthSettings,
  getSettingsForProjects,
  isMuted,
  type ProjectHealthSettings,
} from './settings.js';
import { notifyProjectHealth, type NotifiableProject } from './notifier.js';
import { getStateForProjects, recordEvaluation } from './state.js';

export interface ProjectHealthPassResult {
  evaluated: number;
  opened: number;
  resolved: number;
}

/** Resolve notifications older than this are dropped instead of sent late. */
const RESOLVE_NOTIFY_LOOKBACK_MS = 24 * 60 * 60 * 1000;

interface CounterRow {
  project_id: string;
  pii60m: number;
  revoked60m: number;
  skew_logs: number;
  skew_spans: number;
  skew_metrics: number;
  past_logs: number | null;
  past_spans: number | null;
  past_metrics: number | null;
  future_logs: number | null;
  future_spans: number | null;
  future_metrics: number | null;
}

const toTime = (v: Date | string | null): number | null =>
  v === null ? null : (v instanceof Date ? v : new Date(v)).getTime();

const toNum = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const toNumOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

async function loadCounters(
  projectIds: string[],
  organizationIds: string[],
  now: Date
): Promise<Map<string, CounterRow>> {
  const map = new Map<string, CounterRow>();
  if (projectIds.length === 0) return map;
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since60m = new Date(now.getTime() - 60 * 60 * 1000);
  // tenant-scope-ok: system cron over pre-resolved non-deleted project ids
  const result = await sql<CounterRow>`
    SELECT
      project_id,
      COALESCE(SUM(quantity) FILTER (WHERE type = 'ingestion.pii_rejected' AND time >= ${since60m}), 0)::float8 AS pii60m,
      COALESCE(SUM(quantity) FILTER (WHERE type = 'ingestion.revoked_key' AND time >= ${since60m}), 0)::float8 AS revoked60m,
      COALESCE(SUM(quantity) FILTER (WHERE type = 'ingestion.timestamp_skew'), 0)::float8 AS skew_logs,
      COALESCE(SUM(quantity) FILTER (WHERE type = 'ingestion.span_timestamp_skew'), 0)::float8 AS skew_spans,
      COALESCE(SUM(quantity) FILTER (WHERE type = 'ingestion.metric_timestamp_skew'), 0)::float8 AS skew_metrics,
      MAX((metadata->>'maxPastMs')::float8) FILTER (WHERE type = 'ingestion.timestamp_skew') AS past_logs,
      MAX((metadata->>'maxPastMs')::float8) FILTER (WHERE type = 'ingestion.span_timestamp_skew') AS past_spans,
      MAX((metadata->>'maxPastMs')::float8) FILTER (WHERE type = 'ingestion.metric_timestamp_skew') AS past_metrics,
      MAX((metadata->>'maxFutureMs')::float8) FILTER (WHERE type = 'ingestion.timestamp_skew') AS future_logs,
      MAX((metadata->>'maxFutureMs')::float8) FILTER (WHERE type = 'ingestion.span_timestamp_skew') AS future_spans,
      MAX((metadata->>'maxFutureMs')::float8) FILTER (WHERE type = 'ingestion.metric_timestamp_skew') AS future_metrics
    FROM metering_events
    WHERE organization_id IN (${sql.join(organizationIds)})
      AND project_id IN (${sql.join(projectIds)})
      AND type IN (
        'ingestion.pii_rejected', 'ingestion.revoked_key', 'ingestion.timestamp_skew',
        'ingestion.span_timestamp_skew', 'ingestion.metric_timestamp_skew'
      )
      AND time >= ${since24h}
    GROUP BY project_id
  `.execute(db);
  for (const row of result.rows) map.set(row.project_id, row);
  return map;
}

function buildInputs(
  project: { has_logs_at: Date | string | null; has_traces_at: Date | string | null; has_metrics_at: Date | string | null },
  counters: CounterRow | undefined,
  settings: ProjectHealthSettings,
  now: Date
): ProjectHealthInputs {
  const times = [project.has_logs_at, project.has_traces_at, project.has_metrics_at]
    .map(toTime)
    .filter((t): t is number => t !== null);
  return {
    lastEventAt: times.length ? new Date(Math.max(...times)) : null,
    silentMinutes: settings.silentMinutes,
    piiRejected60m: toNum(counters?.pii60m),
    revokedKey60m: toNum(counters?.revoked60m),
    skew24h: {
      logs: toNum(counters?.skew_logs),
      spans: toNum(counters?.skew_spans),
      metrics: toNum(counters?.skew_metrics),
      maxPastMs: {
        logs: toNumOrNull(counters?.past_logs),
        spans: toNumOrNull(counters?.past_spans),
        metrics: toNumOrNull(counters?.past_metrics),
      },
      maxFutureMs: {
        logs: toNumOrNull(counters?.future_logs),
        spans: toNumOrNull(counters?.future_spans),
        metrics: toNumOrNull(counters?.future_metrics),
      },
    },
    now,
  };
}

/** Reconcile the issue rows of one project with its open checks. */
async function reconcileProject(
  project: NotifiableProject,
  open: Map<ProjectHealthCheckKey, Record<string, unknown>>,
  issues: HealthIssueRow[],
  now: Date,
  baseline: boolean
): Promise<{ opened: number; resolved: ProjectHealthCheckKey[] }> {
  let opened = 0;
  const resolved: ProjectHealthCheckKey[] = [];
  const openRows = new Map<ProjectHealthCheckKey, HealthIssueRow>();
  const recentResolved = new Map<ProjectHealthCheckKey, HealthIssueRow>();
  const reopenSince = now.getTime() - REOPEN_WINDOW_MS;

  for (const row of issues) {
    if (row.resolvedAt === null) {
      openRows.set(row.checkKey, row);
    } else if (row.resolvedAt.getTime() >= reopenSince) {
      const prev = recentResolved.get(row.checkKey);
      if (!prev || (prev.resolvedAt as Date) < row.resolvedAt) recentResolved.set(row.checkKey, row);
    }
  }

  for (const [checkKey, details] of open) {
    const existing = openRows.get(checkKey);
    if (existing) {
      await touchIssue(existing, details, now);
      continue;
    }
    const candidate = recentResolved.get(checkKey);
    if (candidate && (await reopenIssue(candidate, details, now))) continue;
    const created = await openIssue({
      organizationId: project.organizationId,
      projectId: project.id,
      checkKey,
      details,
      now,
      baseline,
    });
    if (created) opened++;
  }

  for (const [checkKey, row] of openRows) {
    if (open.has(checkKey)) continue;
    if (await resolveIssue(row, now)) resolved.push(checkKey);
  }

  if (resolved.length > 0) {
    await clearUntilResolvedMutes(project.organizationId, project.id, resolved);
  }
  return { opened, resolved };
}

/** Send what the state machine says is due, claiming each notification first. */
async function notifyDue(
  project: NotifiableProject,
  issues: HealthIssueRow[],
  settings: ProjectHealthSettings,
  now: Date
): Promise<void> {
  for (const issue of issues) {
    // Baseline issues predate the first evaluation: visible, never notified.
    if (issue.baseline) continue;
    try {
      if (issue.resolvedAt === null) {
        if (issue.notifiedOpenAt !== null) continue;
        if (isMuted(settings.mutes[issue.checkKey], now)) continue;
        if (!(await claimOpenNotification(issue.id, now))) continue;
        await notifyProjectHealth(issue, project, 'opened', { healthChannelIds: settings.healthChannelIds });
      } else {
        if (issue.notifiedOpenAt === null || issue.notifiedResolveAt !== null) continue;
        const sinceResolved = now.getTime() - issue.resolvedAt.getTime();
        if (sinceResolved > RESOLVE_NOTIFY_LOOKBACK_MS) continue;
        // A flapping issue may reopen inside the window: wait it out first.
        if (sinceResolved < REOPEN_WINDOW_MS) continue;
        if (!(await claimResolveNotification(issue.id, now))) continue;
        await notifyProjectHealth(issue, project, 'resolved', { healthChannelIds: settings.healthChannelIds });
      }
    } catch (err) {
      console.error(`[ProjectHealth] notification failed for issue ${issue.id}:`, err);
    }
  }
}

export async function runProjectHealthPass(now: Date = new Date()): Promise<ProjectHealthPassResult> {
  const projects = await db
    .selectFrom('projects')
    .innerJoin('organizations', 'organizations.id', 'projects.organization_id')
    .select([
      'projects.id',
      'projects.name',
      'projects.organization_id',
      'projects.has_logs_at',
      'projects.has_traces_at',
      'projects.has_metrics_at',
    ])
    // tenant-scope-ok: system cron, evaluates every non-deleted project of every org
    .where('projects.deleted_at', 'is', null)
    .execute();

  const result: ProjectHealthPassResult = { evaluated: 0, opened: 0, resolved: 0 };
  if (projects.length === 0) return result;

  const projectIds = projects.map((p) => p.id);
  const [counters, settingsMap, issueRows, stateMap] = await Promise.all([
    loadCounters(projectIds, Array.from(new Set(projects.map((p) => p.organization_id))), now),
    getSettingsForProjects(projectIds),
    loadIssuesForProjects(projectIds, new Date(now.getTime() - RESOLVE_NOTIFY_LOOKBACK_MS)),
    getStateForProjects(projectIds),
  ]);

  const issuesByProject = new Map<string, HealthIssueRow[]>();
  for (const row of issueRows) {
    const list = issuesByProject.get(row.projectId) ?? [];
    list.push(row);
    issuesByProject.set(row.projectId, list);
  }

  for (const p of projects) {
    const project: NotifiableProject = { id: p.id, name: p.name, organizationId: p.organization_id };
    try {
      const settings = settingsMap.get(p.id) ?? defaultProjectHealthSettings();
      const state = stateMap.get(p.id);
      const inputs = buildInputs(p, counters.get(p.id), settings, now);
      const receiving =
        inputs.lastEventAt !== null &&
        now.getTime() - inputs.lastEventAt.getTime() <= settings.silentMinutes * 60_000;
      inputs.silentArmed = receiving || (state?.lastReceivingAt ?? null) !== null;
      const open = computeOpenChecks(inputs);
      const before = issuesByProject.get(p.id) ?? [];
      const { opened, resolved } = await reconcileProject(project, open, before, now, state === undefined);
      await recordEvaluation(p.organization_id, p.id, receiving, now);
      result.evaluated++;
      result.opened += opened;
      result.resolved += resolved.length;
      if (open.size === 0 && before.length === 0) continue;

      // Re-read this project's rows and settings after reconcile so the
      // notification step sees fresh state (mutes cleared on resolve too).
      const [fresh, freshSettings] = await Promise.all([
        loadIssuesForProjects([p.id], new Date(now.getTime() - RESOLVE_NOTIFY_LOOKBACK_MS)),
        resolved.length > 0 ? getSettingsForProjects([p.id]) : Promise.resolve(null),
      ]);
      const effective = freshSettings ? (freshSettings.get(p.id) ?? settings) : settings;
      await notifyDue(project, fresh, effective, now);
    } catch (err) {
      console.error(`[ProjectHealth] evaluation failed for project ${p.id}:`, err);
    }
  }

  return result;
}
