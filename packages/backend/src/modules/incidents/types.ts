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
