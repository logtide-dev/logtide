/**
 * Incidents for every source (1.6): security detections (sigma), alert rules
 * firing (alert), uptime outages (monitor) and manual incidents share one
 * store and one API, `/api/v1/incidents`.
 */
import type { Severity, IncidentStatus } from '../constants/siem-constants.js';
import type { IncidentSource } from '../constants/monitoring-constants.js';
import type { DetectionEvent, Incident, IncidentComment, IncidentHistoryEntry } from './siem.js';
import type { MetricAlertCondition, MetricAlertConfig, MetricAlertWindow } from './metric-alert.js';

/** Statuses that count as an active incident ("investigating" is shown as Acknowledged). */
export const INCIDENT_ACTIVE_STATUSES = ['open', 'investigating'] as const satisfies readonly IncidentStatus[];

export const INCIDENT_SORT_KEYS = ['last_event_at', 'created_at', 'severity'] as const;
export type IncidentSortKey = (typeof INCIDENT_SORT_KEYS)[number];

export const INCIDENT_BULK_ACTIONS = ['acknowledge', 'resolve', 'assign'] as const;
export type IncidentBulkAction = (typeof INCIDENT_BULK_ACTIONS)[number];

export const INCIDENT_BULK_MAX_IDS = 100;

/** Stored as `metadata.reason` on the history row of a change. */
export type IncidentChangeReason = 'recovered' | 'no_data' | 'manual' | 'source_event';

export type IncidentHistoryAction =
  | 'status_change'
  | 'assignment_change'
  | 'severity_change'
  | 'created'
  | 'source_event';

export interface IncidentUserRef {
  id: string;
  name: string;
  email: string;
}

export interface IncidentProjectRef {
  id: string;
  name: string;
}

export interface IncidentSourceRef {
  kind: 'alert' | 'monitor' | 'hardware';
  id: string;
  name: string;
}

export interface IncidentListItem extends Incident {
  assignee: IncidentUserRef | null;
  project: IncidentProjectRef | null;
  /** null for sigma and manual incidents, or when the rule, monitor or hardware host was deleted. */
  sourceRef: IncidentSourceRef | null;
}

export interface IncidentListResponse {
  incidents: IncidentListItem[];
  total: number;
}

/**
 * One alert trigger, monitor check or hardware evaluation behind an alert,
 * uptime or hardware incident;
 * derived from the `created` and `source_event` history rows (empty for sigma
 * and manual).
 */
export interface IncidentSourceEvent {
  id: string;
  kind: 'alert_trigger' | 'monitor_check' | 'hardware_check';
  time: string;
  summary: string;
  detail?: Record<string, unknown>;
}

/** One group (alert instance) of a metric alert incident. */
export interface IncidentMetricAlertGroup {
  /** Stable instance key ('' when the rule is ungrouped). */
  groupKey: string;
  labels: Record<string, string>;
  /** Last evaluated window value, raw (null when unknown). */
  value: number | null;
  /**
   * `firing`: the instance fires now (active incidents only). `resolved`: it
   * fired during this incident and no longer does.
   */
  state: 'firing' | 'resolved';
  /** When the instance started firing (ISO), when known. */
  firingSince: string | null;
}

/** Metric alert incidents: what the rule watches and which groups fired. */
export interface IncidentMetricAlertDetail {
  ruleId: string | null;
  ruleName: string;
  /** Current rule definition (query for the chart); null when the rule was deleted. */
  config: MetricAlertConfig | null;
  /** Query or formula id watched by the rule. */
  queryId: string;
  /** Metric name of a query, expression of a formula. */
  source: string;
  condition: MetricAlertCondition;
  /** Raw threshold (same scale as the values). */
  threshold: number;
  unit: string | null;
  window: MetricAlertWindow;
  /** Firing groups first. */
  groups: IncidentMetricAlertGroup[];
}

export interface IncidentDetailResponse {
  incident: IncidentListItem;
  detections: DetectionEvent[];
  comments: IncidentComment[];
  history: IncidentHistoryEntry[];
  /** Always present, newest first; merged into the detail timeline by the UI. */
  sourceEvents: IncidentSourceEvent[];
  /** Incidents of metric alert rules only (absent or null otherwise). */
  metricAlert?: IncidentMetricAlertDetail | null;
}

export interface IncidentListQuery {
  organizationId: string;
  projectId?: string[];
  status?: IncidentStatus[];
  source?: IncidentSource[];
  severity?: Severity[];
  assignee?: 'me' | 'unassigned' | 'anyone' | string;
  /** Legacy single-assignee filter (uuid). */
  assigneeId?: string;
  service?: string;
  technique?: string;
  /**
   * Sigma rule uuid: the incident has a detection_events row with
   * incident_id = incident.id AND sigma_rule_id = ruleId.
   */
  ruleId?: string;
  sort?: IncidentSortKey;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface IncidentPatchBody {
  organizationId: string;
  status?: IncidentStatus;
  /** null unassigns. */
  assigneeId?: string | null;
  severity?: Severity;
  title?: string;
  description?: string;
}

export interface IncidentBulkRequest {
  organizationId: string;
  ids: string[];
  action: IncidentBulkAction;
  /** Required for `assign`; null unassigns. */
  assigneeId?: string | null;
}

export interface IncidentBulkResult {
  updated: IncidentListItem[];
  skipped: { id: string; reason: 'not_found' | 'invalid_transition' }[];
}

/** Metadata of the `created` and `source_event` history rows of alert, monitor and hardware incidents. */
export interface IncidentSourceEventMetadata {
  source: 'alert' | 'monitor' | 'hardware';
  sourceId: string;
  occurredAt: string;
  data: Record<string, unknown> | null;
}

export type IncidentStreamEvent =
  | { type: 'connected'; timestamp: string }
  | { type: 'incident_created' | 'incident_updated'; data: IncidentListItem }
  | { type: 'detection_created'; data: DetectionEvent };
