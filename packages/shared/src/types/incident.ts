/**
 * Incidents for every source (1.6): security detections (sigma), alert rules
 * firing (alert), uptime outages (monitor) and manual incidents share one
 * store and one API, `/api/v1/incidents`.
 */
import type { Severity, IncidentStatus } from '../constants/siem-constants.js';
import type { IncidentSource } from '../constants/monitoring-constants.js';
import type { DetectionEvent, Incident, IncidentComment, IncidentHistoryEntry } from './siem.js';

/** Statuses that count as an active incident ("investigating" is shown as Acknowledged). */
export const INCIDENT_ACTIVE_STATUSES = ['open', 'investigating'] as const satisfies readonly IncidentStatus[];

export const INCIDENT_SORT_KEYS = ['last_event_at', 'created_at', 'severity'] as const;
export type IncidentSortKey = (typeof INCIDENT_SORT_KEYS)[number];

export const INCIDENT_BULK_ACTIONS = ['acknowledge', 'resolve', 'assign'] as const;
export type IncidentBulkAction = (typeof INCIDENT_BULK_ACTIONS)[number];

export const INCIDENT_BULK_MAX_IDS = 100;

/** Stored as `metadata.reason` on the history row of a change. */
export type IncidentChangeReason = 'recovered' | 'manual' | 'source_event';

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
  kind: 'alert' | 'monitor';
  id: string;
  name: string;
}

export interface IncidentListItem extends Incident {
  assignee: IncidentUserRef | null;
  project: IncidentProjectRef | null;
  /** null for sigma and manual incidents, or when the rule or monitor was deleted. */
  sourceRef: IncidentSourceRef | null;
}

export interface IncidentListResponse {
  incidents: IncidentListItem[];
  total: number;
}

/**
 * One alert trigger or monitor check behind an alert or uptime incident;
 * derived from the `created` and `source_event` history rows (empty for sigma
 * and manual).
 */
export interface IncidentSourceEvent {
  id: string;
  kind: 'alert_trigger' | 'monitor_check';
  time: string;
  summary: string;
  detail?: Record<string, unknown>;
}

export interface IncidentDetailResponse {
  incident: IncidentListItem;
  detections: DetectionEvent[];
  comments: IncidentComment[];
  history: IncidentHistoryEntry[];
  /** Always present, newest first; merged into the detail timeline by the UI. */
  sourceEvents: IncidentSourceEvent[];
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

/** Metadata of the `created` and `source_event` history rows of alert and monitor incidents. */
export interface IncidentSourceEventMetadata {
  source: 'alert' | 'monitor';
  sourceId: string;
  occurredAt: string;
  data: Record<string, unknown> | null;
}

export type IncidentStreamEvent =
  | { type: 'connected'; timestamp: string }
  | { type: 'incident_created' | 'incident_updated'; data: IncidentListItem }
  | { type: 'detection_created'; data: DetectionEvent };
