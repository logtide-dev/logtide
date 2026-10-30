import { describe, it, expect, vi, afterEach } from 'vitest';
import { db } from '../../../database/index.js';
import { incidentsService } from '../../../modules/incidents/service.js';
import {
  alertIncidentSeverity,
  openAlertIncident,
  resolveAlertIncident,
} from '../../../modules/alerts/incident-sync.js';
import type { BaselineMetadata } from '../../../database/types.js';
import { createTestAlertRule, createTestContext } from '../../helpers/factories.js';
import { getRuleRow, setRuleLifecycle } from './lifecycle-test-helpers.js';

const INCIDENT_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-21T10:00:00.000Z');

async function setup(overrides: Parameters<typeof createTestAlertRule>[0] = {}) {
  const ctx = await createTestContext();
  const rule = await createTestAlertRule({
    organizationId: ctx.organization.id,
    projectId: ctx.project.id,
    name: 'High error rate',
    threshold: 10,
    timeWindow: 5,
    level: ['error'],
    ...overrides,
  });
  return { ...ctx, rule, row: await getRuleRow(rule.id) };
}

function ctxFor(overrides: Partial<Parameters<typeof openAlertIncident>[1]> = {}) {
  return {
    now: NOW,
    logCount: 12,
    historyId: null,
    notification: 'triggered' as const,
    baselineMetadata: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('alertIncidentSeverity', () => {
  it('maps levels to severity', () => {
    expect(alertIncidentSeverity(['warn', 'critical'])).toBe('critical');
    expect(alertIncidentSeverity(['error'])).toBe('high');
    expect(alertIncidentSeverity(['warn', 'error'])).toBe('high');
    expect(alertIncidentSeverity(['warn'])).toBe('medium');
    expect(alertIncidentSeverity(['info', 'debug'])).toBe('low');
    expect(alertIncidentSeverity([])).toBe('low');
  });
});

describe('openAlertIncident', () => {
  it('opens an alert incident with source alert and the rule id', async () => {
    const { row } = await setup();
    await setRuleLifecycle(row.id, { query: 'timeout' });
    const fresh = await getRuleRow(row.id);
    const spy = vi
      .spyOn(incidentsService, 'openOrUpdateFromSource')
      .mockResolvedValue({ incident: { id: INCIDENT_ID } as never, created: true });

    const ctx = ctxFor({ historyId: '22222222-2222-4222-8222-222222222222' });
    expect(await openAlertIncident(fresh, ctx)).toBe(INCIDENT_ID);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: fresh.organization_id,
        projectId: fresh.project_id,
        source: 'alert',
        sourceId: fresh.id,
        title: fresh.name,
        severity: 'high',
        occurredAt: ctx.now,
        metadata: expect.objectContaining({
          ruleId: fresh.id,
          query: 'timeout',
          windowTo: ctx.now.toISOString(),
        }),
      })
    );
  });

  it('stores the full rule summary as incident metadata', async () => {
    const { row } = await setup({ service: 'api', level: ['warn', 'error'] });
    const spy = vi
      .spyOn(incidentsService, 'openOrUpdateFromSource')
      .mockResolvedValue({ incident: { id: INCIDENT_ID } as never, created: false });

    await openAlertIncident(row, ctxFor({ historyId: null, notification: null, logCount: 15 }));

    const input = spy.mock.calls[0][0];
    expect(input.metadata).toEqual({
      ruleId: row.id,
      alertType: 'threshold',
      notification: null,
      historyId: null,
      logCount: 15,
      threshold: 10,
      timeWindow: 5,
      level: ['warn', 'error'],
      service: 'api',
      query: null,
      metadataFilters: [],
      windowFrom: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
      windowTo: NOW.toISOString(),
      baselineMetadata: null,
    });
  });

  it('describes a threshold breach with en-US numbers', async () => {
    const { row } = await setup({ threshold: 1000, timeWindow: 1440 });
    const spy = vi
      .spyOn(incidentsService, 'openOrUpdateFromSource')
      .mockResolvedValue({ incident: { id: INCIDENT_ID } as never, created: true });

    await openAlertIncident(row, ctxFor({ logCount: 12345 }));

    expect(spy.mock.calls[0][0].description).toBe(
      '12,345 matching logs in the last 1,440 minutes (threshold 1,000)'
    );
  });

  it('describes a rate-of-change anomaly from the baseline', async () => {
    const { row } = await setup({
      alertType: 'rate_of_change',
      baselineType: 'rolling_7d_avg',
      deviationMultiplier: 3,
      level: ['critical'],
    });
    const baselineMetadata: BaselineMetadata = {
      baseline_value: 1200.4,
      current_value: 12004.2,
      deviation_ratio: 10,
      baseline_type: 'rolling_7d_avg',
      evaluation_time: NOW.toISOString(),
    };
    const spy = vi
      .spyOn(incidentsService, 'openOrUpdateFromSource')
      .mockResolvedValue({ incident: { id: INCIDENT_ID } as never, created: true });

    await openAlertIncident(row, ctxFor({ logCount: 12004, baselineMetadata }));

    const input = spy.mock.calls[0][0];
    expect(input.severity).toBe('critical');
    expect(input.description).toBe('Log volume 10x above baseline (12,004 vs 1,200 logs per hour)');
    expect(input.metadata).toEqual(
      expect.objectContaining({ alertType: 'rate_of_change', baselineMetadata })
    );
  });

  it('passes a null project for an organization-wide rule', async () => {
    const { row } = await setup({ projectId: null });
    const spy = vi
      .spyOn(incidentsService, 'openOrUpdateFromSource')
      .mockResolvedValue({ incident: { id: INCIDENT_ID } as never, created: true });

    await openAlertIncident(row, ctxFor());

    expect(spy.mock.calls[0][0].projectId).toBeNull();
  });

  it('returns null and logs when F4 throws', async () => {
    const { row } = await setup();
    vi.spyOn(incidentsService, 'openOrUpdateFromSource').mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await openAlertIncident(row, ctxFor())).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`[Alerts] Incident sync failed for rule ${row.id}`),
      expect.any(Error)
    );
  });
});

describe('resolveAlertIncident', () => {
  it('resolves with the given reason', async () => {
    const { row } = await setup();
    const spy = vi
      .spyOn(incidentsService, 'resolveFromSource')
      .mockResolvedValue({ id: INCIDENT_ID } as never);

    expect(await resolveAlertIncident(row, 'manual', NOW)).toBe(INCIDENT_ID);
    expect(spy).toHaveBeenCalledWith({
      organizationId: row.organization_id,
      source: 'alert',
      sourceId: row.id,
      resolvedAt: NOW,
      reason: 'manual',
    });
  });

  it('returns null when nothing was active', async () => {
    const { row } = await setup();
    expect(await resolveAlertIncident(row, 'recovered', NOW)).toBeNull();
  });

  it('returns null and logs when F4 throws', async () => {
    const { row } = await setup();
    vi.spyOn(incidentsService, 'resolveFromSource').mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await resolveAlertIncident(row, 'recovered', NOW)).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`[Alerts] Incident sync failed for rule ${row.id}`),
      expect.any(Error)
    );
  });
});

describe('round trip through F4', () => {
  it('round-trips a real incident through F4', async () => {
    const { row, organization, project } = await setup();

    const openedId = await openAlertIncident(row, ctxFor({ logCount: 12 }));
    expect(openedId).toEqual(expect.any(String));

    const opened = await db
      .selectFrom('incidents')
      .selectAll()
      .where('id', '=', openedId!)
      .where('organization_id', '=', organization.id)
      .executeTakeFirstOrThrow();
    expect(opened).toMatchObject({
      source: 'alert',
      alert_rule_id: row.id,
      project_id: project.id,
      title: 'High error rate',
      severity: 'high',
      status: 'open',
      description: '12 matching logs in the last 5 minutes (threshold 10)',
    });

    // A second firing call updates the same open incident.
    const later = new Date(NOW.getTime() + 30 * 60_000);
    expect(await openAlertIncident(row, ctxFor({ now: later, notification: 'renotify' }))).toBe(openedId);

    const history = await db
      .selectFrom('incident_history')
      .select(['action', 'metadata'])
      .where('incident_id', '=', openedId!)
      .execute();
    const sourceEvents = history.filter((h) => h.action === 'created' || h.action === 'source_event');
    expect(sourceEvents).toHaveLength(2);
    expect(sourceEvents.map((h) => (h.metadata as any).data.ruleId)).toEqual([row.id, row.id]);

    const resolvedAt = new Date(NOW.getTime() + 40 * 60_000);
    expect(await resolveAlertIncident(row, 'recovered', resolvedAt)).toBe(openedId);

    const resolved = await db
      .selectFrom('incidents')
      .selectAll()
      .where('id', '=', openedId!)
      .where('organization_id', '=', organization.id)
      .executeTakeFirstOrThrow();
    expect(resolved.status).toBe('resolved');
    expect(new Date(resolved.resolved_at!).getTime()).toBe(resolvedAt.getTime());

    // Idempotent: nothing active any more.
    expect(await resolveAlertIncident(row, 'recovered', resolvedAt)).toBeNull();
  });
});
