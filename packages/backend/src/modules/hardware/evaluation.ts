/**
 * Hardware evaluation pass (worker timer, every HARDWARE_EVALUATION_INTERVAL_MS).
 *
 * For every project with due hosts: load the evaluator inputs with one query
 * set, evaluate each host, persist the result with a compare-and-set on the
 * stored status, and act on status transitions:
 *  - ok/unknown -> warning/critical, warning -> critical: open or update the
 *    hardware incident and notify (degraded);
 *  - critical -> warning: lower the incident severity, no notification;
 *  - -> ok: resolve the incident and notify (recovered) when one was active;
 *  - -> stale or unknown: nothing (v1 has no stale incidents);
 *  - stale -> warning/critical: reconciled against the active incident, so a
 *    host that only stopped reporting for a while is not notified twice.
 * Muted hosts are evaluated and persisted but never open incidents or notify;
 * a muted host back to ok still resolves its incident, silently.
 * Only the worker whose compare-and-set wins acts, so two workers never
 * double notify.
 */
import type { HardwareFinding, HardwareStatus, Severity } from '@logtide/shared';
import { hub } from '@logtide/core';
import { incidentsService } from '../incidents/service.js';
import { isInternalLoggingEnabled } from '../../utils/internal-logger.js';
import { evaluateHost } from './evaluator.js';
import { loadProjectHardwareData } from './loader.js';
import { notifyHardware, hardwareHostLink, hardwareTitle, type NotifiableHardwareHost } from './notifier.js';
import { activeIncidentSeverity, listDueHosts, saveEvaluation, type DueHardwareHost } from './repository.js';

export interface HardwarePassResult {
  evaluated: number;
  opened: number;
  escalated: number;
  deescalated: number;
  resolved: number;
  skipped: number;
}

/** Findings copied into the incident description. */
const DESCRIPTION_FINDINGS = 5;
/** Findings stored in the incident history metadata. */
const METADATA_FINDINGS = 20;

const SEVERITY_BY_STATUS: Record<'warning' | 'critical', Severity> = {
  warning: 'medium',
  critical: 'critical',
};

const SEVERITY_RANK: Record<string, number> = { informational: 1, low: 2, medium: 3, high: 4, critical: 5 };

function isProblem(status: HardwareStatus): status is 'warning' | 'critical' {
  return status === 'warning' || status === 'critical';
}

function describeFindings(findings: HardwareFinding[]): string {
  const top = findings.slice(0, DESCRIPTION_FINDINGS).map((f) => `- ${f.message}`);
  const more = findings.length - top.length;
  if (more > 0) top.push(`- ${more.toLocaleString('en-US')} more on the host page`);
  return top.join('\n');
}

type Action = 'open' | 'escalate' | 'deescalate' | 'resolve' | 'none';

/** What a status change means for the incident, before looking at the incident itself. */
export function planTransition(prev: HardwareStatus, next: HardwareStatus): Action | 'reconcile' {
  if (prev === next) return 'none';
  if (next === 'ok') return 'resolve';
  if (!isProblem(next)) return 'none';
  if (prev === 'ok' || prev === 'unknown') return 'open';
  if (prev === 'warning' && next === 'critical') return 'escalate';
  if (prev === 'critical' && next === 'warning') return 'deescalate';
  return 'reconcile'; // stale -> warning/critical
}

async function reconcile(host: DueHardwareHost, next: 'warning' | 'critical'): Promise<Action> {
  const current = await activeIncidentSeverity(host.organizationId, host.id);
  if (current === null) return 'open';
  const target = SEVERITY_RANK[SEVERITY_BY_STATUS[next]];
  const have = SEVERITY_RANK[current] ?? 0;
  if (have < target) return 'escalate';
  if (have > target) return 'deescalate';
  return 'none';
}

async function act(
  host: DueHardwareHost,
  prev: HardwareStatus,
  next: HardwareStatus,
  findings: HardwareFinding[],
  now: Date,
  result: HardwarePassResult
): Promise<void> {
  let action = planTransition(prev, next);
  if (action === 'none') return;
  if (action === 'reconcile') action = await reconcile(host, next as 'warning' | 'critical');
  if (action === 'none') return;

  const notifiable: NotifiableHardwareHost = {
    id: host.id,
    hostName: host.hostName,
    projectId: host.projectId,
    projectName: host.projectName,
    organizationId: host.organizationId,
  };

  if (action === 'resolve') {
    const resolved = await incidentsService.resolveFromSource({
      organizationId: host.organizationId,
      source: 'hardware',
      sourceId: host.id,
      resolvedAt: now,
      reason: 'recovered',
    });
    if (!resolved) return;
    result.resolved++;
    if (host.muted) return;
    await notifyHardware(notifiable, {
      kind: 'recovered',
      status: 'ok',
      previousStatus: prev,
      findings: [],
      incidentId: resolved.id,
      changedAt: now,
    });
    return;
  }

  if (host.muted) return;
  const status = next as 'warning' | 'critical';
  const severity = SEVERITY_BY_STATUS[status];
  const title = hardwareTitle(status, host.hostName);

  if (action === 'deescalate') {
    const updated = await incidentsService.setSeverityFromSource({
      organizationId: host.organizationId,
      source: 'hardware',
      sourceId: host.id,
      severity,
      title,
    });
    if (updated) result.deescalated++;
    return;
  }

  // open or escalate
  const { incident, created } = await incidentsService.openOrUpdateFromSource({
    organizationId: host.organizationId,
    projectId: host.projectId,
    source: 'hardware',
    sourceId: host.id,
    title,
    description: describeFindings(findings),
    severity,
    occurredAt: now,
    metadata: {
      summary: `Hardware status ${prev} -> ${status}`,
      status,
      previousStatus: prev,
      findings: findings.slice(0, METADATA_FINDINGS),
      link: hardwareHostLink(host.id),
    },
  });
  if (!created) {
    // Escalation of an active incident: the title follows the new status.
    await incidentsService.setSeverityFromSource({
      organizationId: host.organizationId,
      source: 'hardware',
      sourceId: host.id,
      severity,
      title,
    });
  }
  if (created) result.opened++;
  else result.escalated++;

  await notifyHardware(notifiable, {
    kind: 'degraded',
    status,
    previousStatus: prev,
    findings,
    incidentId: incident.id,
    changedAt: now,
  });
}

function logError(message: string, error: unknown, meta: Record<string, unknown>): void {
  console.error(`[Hardware] ${message}:`, error);
  if (isInternalLoggingEnabled()) {
    hub.captureLog('error', `[Hardware] ${message}`, {
      ...meta,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function runHardwarePass(now: Date = new Date()): Promise<HardwarePassResult> {
  const result: HardwarePassResult = { evaluated: 0, opened: 0, escalated: 0, deescalated: 0, resolved: 0, skipped: 0 };
  const hosts = await listDueHosts(now);

  const byProject = new Map<string, DueHardwareHost[]>();
  for (const h of hosts) {
    const list = byProject.get(h.projectId) ?? [];
    list.push(h);
    byProject.set(h.projectId, list);
  }

  for (const [projectId, projectHosts] of byProject) {
    const organizationId = projectHosts[0].organizationId;
    let data;
    try {
      data = await loadProjectHardwareData(projectId, organizationId, new Set(projectHosts.map((h) => h.hostName)), now);
      if (data.truncated) {
        console.warn(`[Hardware] latest window of project ${projectId} truncated, oldest points skipped`);
      }
    } catch (error) {
      logError('loading hardware data failed', error, { projectId });
      continue;
    }

    for (const host of projectHosts) {
      try {
        const input = data.hosts.get(host.hostName) ?? { latest: [], history: [] };
        const evaluation = evaluateHost({ latest: input.latest, history: input.history, now, lastSeenAt: host.lastSeenAt });
        const saved = await saveEvaluation(host, host.status, evaluation, now);
        result.evaluated++;
        if (!saved) {
          result.skipped++;
          continue;
        }
        await act(host, host.status, evaluation.status, evaluation.findings, now, result);
      } catch (error) {
        logError('host evaluation failed', error, { projectId, hostId: host.id });
      }
    }
  }
  return result;
}
