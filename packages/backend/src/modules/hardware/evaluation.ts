/**
 * Hardware evaluation pass (worker timer, every HARDWARE_EVALUATION_INTERVAL_MS).
 *
 * For every project with due hosts: load the evaluator inputs with one query
 * set, evaluate each host, debounce the result into the effective status
 * (transition.ts), persist it with a compare-and-set and act:
 *  - a host that degrades (effective ok/unknown/stale -> warning/critical)
 *    starts an episode; a host back to ok ends it;
 *  - every pass reconciles a non muted warning/critical host with its
 *    incident: when the episode has none yet (first pass, an earlier pass
 *    failed, or the host was just unmuted) the active incident of the host
 *    is adopted, or a new one is opened and notified. An incident of the
 *    episode resolved by a user is left alone until the host recovers and
 *    degrades again;
 *  - warning -> critical escalates the incident (retitled) and notifies;
 *    critical -> warning lowers it without notification;
 *  - recovery resolves the active incident and sends the recovered
 *    notification (not for muted hosts), and always resolves the episode
 *    incident on PagerDuty, even muted or already resolved by hand.
 * Stale: only the status moves (the snapshot is kept, the incident stays
 * open). No point at all in the latest window while not stale is no new
 * information: the status and snapshot are kept.
 * Only the worker whose compare-and-set wins acts, so two workers never
 * double notify.
 */
import type { HardwareFinding, HardwareStatus, Severity } from '@logtide/shared';
import { hub } from '@logtide/core';
import { incidentsService } from '../incidents/service.js';
import { isInternalLoggingEnabled } from '../../utils/internal-logger.js';
import { evaluateHost } from './evaluator.js';
import { loadProjectHardwareData } from './loader.js';
import {
  notifyHardware,
  hardwareHostLink,
  hardwareTitle,
  resolveHardwarePagerDuty,
  type NotifiableHardwareHost,
} from './notifier.js';
import {
  activeHardwareIncident,
  listDueHosts,
  saveHostState,
  setEpisodeIncident,
  type DueHardwareHost,
  type HostStatePatch,
} from './repository.js';
import { debounceStatus, isProblemStatus } from './transition.js';

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

function describeFindings(findings: HardwareFinding[]): string {
  const top = findings.slice(0, DESCRIPTION_FINDINGS).map((f) => `- ${f.message}`);
  const more = findings.length - top.length;
  if (more > 0) top.push(`- ${more.toLocaleString('en-US')} more on the host page`);
  return top.join('\n');
}

function notifiableOf(host: DueHardwareHost): NotifiableHardwareHost {
  return {
    id: host.id,
    hostName: host.hostName,
    projectId: host.projectId,
    projectName: host.projectName,
    organizationId: host.organizationId,
  };
}

interface PassOutcome {
  prev: HardwareStatus;
  next: HardwareStatus;
  /** Episode as saved by this pass. */
  episodeStartedAt: Date | null;
  episodeIncidentId: string | null;
  /** The episode this pass closed (recovery), with its incident. */
  recovered: { incidentId: string | null } | null;
  findings: HardwareFinding[];
}

/** Recovery: resolve, notify (unless muted), and always resolve on PagerDuty. */
async function recover(host: DueHardwareHost, o: PassOutcome, now: Date, result: HardwarePassResult): Promise<void> {
  const resolved = await incidentsService.resolveFromSource({
    organizationId: host.organizationId,
    source: 'hardware',
    sourceId: host.id,
    resolvedAt: now,
    reason: 'recovered',
  });
  const toResolve = new Set<string>();
  if (o.recovered?.incidentId) toResolve.add(o.recovered.incidentId);
  if (resolved) {
    result.resolved++;
    toResolve.add(resolved.id);
    if (!host.muted) {
      // Carries the PagerDuty resolve of this incident.
      await notifyHardware(notifiableOf(host), {
        kind: 'recovered',
        status: 'ok',
        previousStatus: o.prev,
        findings: [],
        incidentId: resolved.id,
        changedAt: now,
      });
      toResolve.delete(resolved.id);
    }
  }
  for (const incidentId of toResolve) {
    await resolveHardwarePagerDuty(notifiableOf(host), incidentId, 'recovered');
  }
}

/** Makes sure a non muted warning/critical host has the incident of its episode. */
async function reconcile(host: DueHardwareHost, o: PassOutcome, now: Date, result: HardwarePassResult): Promise<void> {
  const status = o.next as 'warning' | 'critical';
  const severity = SEVERITY_BY_STATUS[status];
  const title = hardwareTitle(status, host.hostName);
  const setSeverity = () =>
    incidentsService.setSeverityFromSource({
      organizationId: host.organizationId,
      source: 'hardware',
      sourceId: host.id,
      severity,
      title,
    });
  const notifyDegraded = (incidentId: string) =>
    notifyHardware(notifiableOf(host), {
      kind: 'degraded',
      status,
      previousStatus: o.prev,
      findings: o.findings,
      incidentId,
      changedAt: now,
    });

  if (o.episodeIncidentId) {
    // Steady state costs nothing: the incident is either still active (then
    // only a level change matters) or resolved by a user (left alone).
    if (o.prev === o.next) return;
    const updated = await setSeverity();
    if (!updated) return;
    if (o.prev === 'warning' && o.next === 'critical') {
      result.escalated++;
      await notifyDegraded(updated.id);
    } else if (o.prev === 'critical' && o.next === 'warning') {
      result.deescalated++;
    }
    return;
  }

  // No incident in this episode yet (one indexed lookup).
  const active = await activeHardwareIncident(host.organizationId, host.id);
  if (active) {
    // E.g. opened before a mute, or before a stale period: adopt it.
    await setEpisodeIncident(host, o.episodeStartedAt!, active.id);
    if (active.severity !== severity) await setSeverity();
    return;
  }
  const { incident, created } = await incidentsService.openOrUpdateFromSource({
    organizationId: host.organizationId,
    projectId: host.projectId,
    source: 'hardware',
    sourceId: host.id,
    title,
    description: describeFindings(o.findings),
    severity,
    occurredAt: now,
    metadata: {
      summary: `Hardware status ${o.prev} -> ${status}`,
      status,
      previousStatus: o.prev,
      findings: o.findings.slice(0, METADATA_FINDINGS),
      link: hardwareHostLink(host.id),
    },
  });
  await setEpisodeIncident(host, o.episodeStartedAt!, incident.id);
  if (!created) return; // opened by a concurrent caller, which notifies
  result.opened++;
  await notifyDegraded(incident.id);
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

async function evaluateOne(
  host: DueHardwareHost,
  input: { latest: Parameters<typeof evaluateHost>[0]['latest']; history: Parameters<typeof evaluateHost>[0]['history']; partial: boolean },
  now: Date,
  result: HardwarePassResult
): Promise<void> {
  const evaluation = evaluateHost({
    latest: input.latest,
    history: input.history,
    now,
    lastSeenAt: host.lastSeenAt,
    partial: input.partial,
  });
  const raw = evaluation.status;
  // No point in the latest window while not stale: nothing new to judge.
  const noNews = input.latest.length === 0 && raw !== 'stale';
  const prev = host.status;
  const episodeOpen = host.episodeStartedAt !== null;

  const debounced = noNews
    ? { status: prev, pendingStatus: host.pendingStatus, pendingSince: host.pendingSince }
    : debounceStatus(
        { status: prev, pendingStatus: host.pendingStatus, pendingSince: host.pendingSince, episodeOpen },
        raw,
        now
      );
  const next = debounced.status;

  let episodeStartedAt = host.episodeStartedAt;
  let episodeIncidentId = host.episodeIncidentId;
  let recovered: PassOutcome['recovered'] = null;
  if (isProblemStatus(next) && !episodeStartedAt) {
    episodeStartedAt = now;
    episodeIncidentId = null;
  } else if (next === 'ok' && (episodeOpen || isProblemStatus(prev))) {
    recovered = { incidentId: episodeIncidentId };
    episodeStartedAt = null;
    episodeIncidentId = null;
  }

  const patch: HostStatePatch = {
    ...debounced,
    episodeStartedAt,
    episodeIncidentId,
    // Stale or no new point: keep the last snapshot.
    ...(!noNews && raw !== 'stale' && { snapshot: evaluation }),
  };
  const saved = await saveHostState(host, patch, now);
  result.evaluated++;
  if (!saved) {
    result.skipped++;
    return;
  }

  const outcome: PassOutcome = { prev, next, episodeStartedAt, episodeIncidentId, recovered, findings: evaluation.findings };
  if (recovered) {
    await recover(host, outcome, now, result);
    return;
  }
  if (host.muted || !isProblemStatus(next)) return;
  await reconcile(host, outcome, now, result);
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
    } catch (error) {
      logError('loading hardware data failed', error, { projectId });
      continue;
    }

    for (const host of projectHosts) {
      try {
        const input = data.hosts.get(host.hostName) ?? { latest: [], history: [], partial: false };
        await evaluateOne(host, input, now, result);
      } catch (error) {
        logError('host evaluation failed', error, { projectId, hostId: host.id });
      }
    }
  }
  return result;
}
