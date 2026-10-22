import type { Selectable } from 'kysely';
import type { LogLevel, MetadataFilter, Severity } from '@logtide/shared';
import type { AlertRulesTable, BaselineMetadata } from '../../database/types.js';
// The service file, not the barrel: the barrel also pulls in the incidents
// routes (Fastify), which the worker must not load.
import { incidentsService } from '../incidents/service.js';
import type { AlertIncidentMetadata, AlertNotificationKind } from './types.js';

/**
 * Alert rule <-> incident (F4) synchronisation. Called only on lifecycle
 * transitions and re-notifications (never on steady firing), after the
 * compare-and-set transaction of the evaluation committed, and before a user
 * disables or deletes a firing rule. F4 failures are logged and swallowed:
 * the alert notification still goes out, with `incident_id: null`.
 */

export interface OpenAlertIncidentContext {
  now: Date;
  /** Matching logs in the window (threshold) or the current hourly rate (rate-of-change). */
  logCount: number;
  historyId: string | null;
  /** The notification sent with this transition, null when snoozed. */
  notification: AlertNotificationKind | null;
  baselineMetadata: BaselineMetadata | null;
}

/** Alert rules have no severity column: derive it from the watched levels. */
export function alertIncidentSeverity(level: LogLevel[]): Severity {
  if (level.includes('critical')) return 'critical';
  if (level.includes('error')) return 'high';
  if (level.includes('warn')) return 'medium';
  return 'low';
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function describeTrigger(rule: Selectable<AlertRulesTable>, ctx: OpenAlertIncidentContext): string {
  const baseline = ctx.baselineMetadata;
  if (rule.alert_type === 'rate_of_change' && baseline) {
    return (
      `Log volume ${formatNumber(baseline.deviation_ratio)}x above baseline ` +
      `(${formatNumber(Math.round(baseline.current_value))} vs ` +
      `${formatNumber(Math.round(baseline.baseline_value))} logs per hour)`
    );
  }
  return (
    `${formatNumber(ctx.logCount)} matching logs in the last ${formatNumber(rule.time_window)} minutes ` +
    `(threshold ${formatNumber(rule.threshold)})`
  );
}

function logFailure(ruleId: string, error: unknown): void {
  console.error(`[Alerts] Incident sync failed for rule ${ruleId}:`, error);
}

/**
 * Opens the rule's incident, or updates the open one. Returns the incident
 * id, or null when F4 failed (logged).
 */
export async function openAlertIncident(
  rule: Selectable<AlertRulesTable>,
  ctx: OpenAlertIncidentContext
): Promise<string | null> {
  const metadata: AlertIncidentMetadata = {
    ruleId: rule.id,
    alertType: rule.alert_type,
    notification: ctx.notification,
    historyId: ctx.historyId,
    logCount: ctx.logCount,
    threshold: rule.threshold,
    timeWindow: rule.time_window,
    level: [...rule.level],
    service: rule.service ?? null,
    query: rule.query ?? null,
    metadataFilters: ((rule.metadata_filters ?? []) as MetadataFilter[]).map((f) => ({ ...f })),
    windowFrom: new Date(ctx.now.getTime() - rule.time_window * 60_000).toISOString(),
    windowTo: ctx.now.toISOString(),
    baselineMetadata: ctx.baselineMetadata,
  };

  try {
    const { incident } = await incidentsService.openOrUpdateFromSource({
      organizationId: rule.organization_id,
      // Rules are created with a project of their own organization (or none).
      projectId: rule.project_id ?? null,
      source: 'alert',
      sourceId: rule.id,
      title: rule.name,
      description: describeTrigger(rule, ctx),
      severity: alertIncidentSeverity(rule.level),
      occurredAt: ctx.now,
      metadata: metadata as unknown as Record<string, unknown>,
    });
    return incident.id;
  } catch (error) {
    logFailure(rule.id, error);
    return null;
  }
}

/**
 * Resolves the rule's active incident. `recovered`: the rule stopped firing;
 * `manual`: a user disabled or deleted it (call before the delete, the
 * incident loses its rule id on delete). Returns the incident id, or null
 * when nothing was active or F4 failed (logged).
 */
export async function resolveAlertIncident(
  rule: { id: string; organization_id: string },
  reason: 'recovered' | 'manual',
  now: Date
): Promise<string | null> {
  try {
    const incident = await incidentsService.resolveFromSource({
      organizationId: rule.organization_id,
      source: 'alert',
      sourceId: rule.id,
      resolvedAt: now,
      reason,
    });
    return incident?.id ?? null;
  } catch (error) {
    logFailure(rule.id, error);
    return null;
  }
}
