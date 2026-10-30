import type { Selectable } from 'kysely';
import type { Incident, IncidentListItem, IncidentSource, IncidentSourceRef } from '@logtide/shared';
import type { IncidentsTable } from '../../database/types.js';

/** An incidents row plus the columns joined in by the incidents service list query. */
export type IncidentJoinedRow = Selectable<IncidentsTable> & {
  assignee_name: string | null;
  assignee_email: string | null;
  project_name: string | null;
  alert_rule_name: string | null;
  monitor_name: string | null;
};

export function mapIncidentRow(row: Selectable<IncidentsTable>): Incident {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    severity: row.severity,
    status: row.status,
    assigneeId: row.assignee_id,
    traceId: row.trace_id,
    timeWindowStart: row.time_window_start,
    timeWindowEnd: row.time_window_end,
    detectionCount: row.detection_count,
    affectedServices: row.affected_services,
    mitreTactics: row.mitre_tactics,
    mitreTechniques: row.mitre_techniques,
    ipReputation: row.ip_reputation,
    geoData: row.geo_data,
    source: (row.source ?? 'sigma') as IncidentSource,
    monitorId: row.monitor_id ?? null,
    alertRuleId: row.alert_rule_id ?? null,
    acknowledgedAt: row.acknowledged_at ?? null,
    acknowledgedBy: row.acknowledged_by ?? null,
    resolvedBy: row.resolved_by ?? null,
    lastEventAt: row.last_event_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

function sourceRefOf(row: IncidentJoinedRow): IncidentSourceRef | null {
  if (row.source === 'alert' && row.alert_rule_id && row.alert_rule_name !== null) {
    return { kind: 'alert', id: row.alert_rule_id, name: row.alert_rule_name };
  }
  if (row.source === 'monitor' && row.monitor_id && row.monitor_name !== null) {
    return { kind: 'monitor', id: row.monitor_id, name: row.monitor_name };
  }
  return null;
}

export function mapIncidentListRow(row: IncidentJoinedRow): IncidentListItem {
  const {
    assignee_name: assigneeName,
    assignee_email: assigneeEmail,
    project_name: projectName,
    alert_rule_name: _alertRuleName,
    monitor_name: _monitorName,
    ...incidentRow
  } = row;

  return {
    ...mapIncidentRow(incidentRow),
    assignee:
      row.assignee_id && assigneeName !== null && assigneeEmail !== null
        ? { id: row.assignee_id, name: assigneeName, email: assigneeEmail }
        : null,
    project: row.project_id && projectName !== null ? { id: row.project_id, name: projectName } : null,
    sourceRef: sourceRefOf(row),
  };
}
