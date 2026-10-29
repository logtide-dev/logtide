import { describe, it, expect } from 'vitest';
import type { Selectable } from 'kysely';
import type { IncidentsTable } from '../../../database/types.js';
import {
  mapIncidentRow,
  mapIncidentListRow,
  type IncidentJoinedRow,
} from '../../../modules/incidents/mappers.js';

const t = new Date('2026-10-21T10:00:00.000Z');
const created = new Date('2026-10-21T09:00:00.000Z');

function row(overrides: Partial<Selectable<IncidentsTable>> = {}): Selectable<IncidentsTable> {
  return {
    id: 'i1',
    organization_id: 'o1',
    project_id: 'p1',
    title: 'Something broke',
    description: null,
    severity: 'high',
    status: 'open',
    assignee_id: null,
    trace_id: null,
    time_window_start: null,
    time_window_end: null,
    detection_count: 0,
    affected_services: null,
    mitre_tactics: null,
    mitre_techniques: null,
    ip_reputation: null,
    geo_data: null,
    source: 'alert',
    monitor_id: null,
    alert_rule_id: null,
    acknowledged_at: null,
    acknowledged_by: null,
    resolved_by: null,
    last_event_at: created,
    created_at: created,
    updated_at: created,
    resolved_at: null,
    ...overrides,
  };
}

function joined(overrides: Partial<IncidentJoinedRow> = {}): IncidentJoinedRow {
  return {
    ...row(),
    assignee_name: null,
    assignee_email: null,
    project_name: 'Web',
    alert_rule_name: null,
    monitor_name: null,
    ...overrides,
  };
}

describe('incident mappers', () => {
  it('maps a raw row to the camelCase incident with new fields', () => {
    const inc = mapIncidentRow(
      row({ alert_rule_id: 'r1', acknowledged_by: 'u1', acknowledged_at: t, resolved_by: 'u2', last_event_at: t })
    );
    expect(inc).toMatchObject({
      id: 'i1',
      organizationId: 'o1',
      projectId: 'p1',
      alertRuleId: 'r1',
      acknowledgedBy: 'u1',
      acknowledgedAt: t,
      resolvedBy: 'u2',
      lastEventAt: t,
      source: 'alert',
      monitorId: null,
      createdAt: created,
      updatedAt: created,
      resolvedAt: null,
    });
  });

  it('defaults a missing source to sigma', () => {
    expect(mapIncidentRow(row({ source: undefined as unknown as string })).source).toBe('sigma');
  });

  it('builds assignee, project and sourceRef from joined columns', () => {
    const item = mapIncidentListRow(
      joined({
        source: 'alert',
        alert_rule_id: 'r1',
        alert_rule_name: 'High errors',
        assignee_id: 'u1',
        assignee_name: 'Ada',
        assignee_email: 'ada@example.com',
      })
    );
    expect(item.sourceRef).toEqual({ kind: 'alert', id: 'r1', name: 'High errors' });
    expect(item.assignee).toEqual({ id: 'u1', name: 'Ada', email: 'ada@example.com' });
    expect(item.project).toEqual({ id: 'p1', name: 'Web' });
    expect(item.alertRuleId).toBe('r1');

    const monitor = mapIncidentListRow(
      joined({ source: 'monitor', monitor_id: 'm1', monitor_name: 'API health' })
    );
    expect(monitor.sourceRef).toEqual({ kind: 'monitor', id: 'm1', name: 'API health' });
  });

  it('returns null refs when the joined rows are missing', () => {
    const item = mapIncidentListRow(
      joined({ assignee_id: 'u1', assignee_name: null, assignee_email: null, project_id: null, project_name: null })
    );
    expect(item.assignee).toBeNull();
    expect(item.project).toBeNull();

    expect(mapIncidentListRow(joined({ source: 'monitor', monitor_id: null })).sourceRef).toBeNull();
    // rule id still set but the join found nothing (rule of another org)
    expect(
      mapIncidentListRow(joined({ source: 'alert', alert_rule_id: 'r1', alert_rule_name: null })).sourceRef
    ).toBeNull();
    expect(mapIncidentListRow(joined({ source: 'alert', alert_rule_id: null })).sourceRef).toBeNull();
  });

  it('never builds a sourceRef for sigma or manual incidents', () => {
    for (const source of ['sigma', 'manual']) {
      const item = mapIncidentListRow(
        joined({
          source,
          alert_rule_id: 'r1',
          alert_rule_name: 'High errors',
          monitor_id: 'm1',
          monitor_name: 'API health',
        })
      );
      expect(item.sourceRef).toBeNull();
    }
  });

  it('does not leak the join columns into the item', () => {
    const item = mapIncidentListRow(joined({ alert_rule_name: 'x' })) as unknown as Record<string, unknown>;
    for (const key of ['assignee_name', 'assignee_email', 'project_name', 'alert_rule_name', 'monitor_name']) {
      expect(key in item).toBe(false);
    }
  });
});
