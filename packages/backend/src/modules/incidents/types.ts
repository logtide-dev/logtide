import type {
  Incident,
  IncidentSortKey,
  IncidentSource,
  IncidentStatus,
  Severity,
} from '@logtide/shared';

/** The shared camelCase incident; the name is the spec 6.5 contract. */
export type IncidentRow = Incident;

export interface IncidentListFilters {
  organizationId: string;
  projectIds?: string[];
  status?: IncidentStatus[];
  source?: IncidentSource[];
  severity?: Severity[];
  /** null = unassigned, undefined = anyone. */
  assigneeId?: string | null;
  service?: string;
  technique?: string;
  /** Sigma rule uuid: a detection_events row exists with incident_id = incident AND sigma_rule_id = ruleId. */
  ruleId?: string;
  sort?: IncidentSortKey;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/** Input of `incidentsService.openOrUpdateFromSource` (spec 6.5). */
export interface OpenOrUpdateFromSourceInput {
  organizationId: string;
  projectId: string | null;
  source: 'alert' | 'monitor';
  /** Alert rule id for source alert, monitor id for source monitor. */
  sourceId: string;
  title: string;
  description?: string;
  severity: Severity;
  occurredAt: Date;
  /** Stored as `data` of the history row (shown as the alert trigger or monitor check detail). */
  metadata?: Record<string, unknown>;
}

/** Input of `incidentsService.resolveFromSource` (spec 6.5). */
export interface ResolveFromSourceInput {
  organizationId: string;
  source: 'alert' | 'monitor';
  sourceId: string;
  resolvedAt: Date;
  /** `recovered`: the source is healthy again; `manual`: a user disabled or deleted the rule or monitor. */
  reason: 'recovered' | 'manual';
}

export type IncidentErrorCode = 'invalid_transition' | 'invalid_assignee' | 'source_not_found';

const STATUS_BY_CODE: Record<IncidentErrorCode, 400 | 404 | 409> = {
  invalid_assignee: 400,
  source_not_found: 404,
  invalid_transition: 409,
};

/** Typed error of the incidents service; routes answer `statusCode` with `{ error: message, code }`. */
export class IncidentError extends Error {
  readonly statusCode: 400 | 404 | 409;
  readonly code: IncidentErrorCode;

  constructor(code: IncidentErrorCode, message: string) {
    super(message);
    this.name = 'IncidentError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
  }
}
