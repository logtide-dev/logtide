import { getApiUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';
import type {
  IncidentBulkResult,
  IncidentComment,
  IncidentHistoryEntry,
  IncidentListItem,
  IncidentListResponse,
  IncidentSourceEvent,
  IncidentStatus,
  DetectionEvent,
  Severity,
} from '@logtide/shared';

export type {
  IncidentBulkResult,
  IncidentListItem,
  IncidentListResponse,
  IncidentSourceEvent,
} from '@logtide/shared';

export type IncidentSource = 'sigma' | 'alert' | 'monitor' | 'manual';

export type BulkAction = 'acknowledge' | 'resolve' | 'assign';

/** Assignee filter: `me` and `unassigned` are resolved by the server. */
export type InboxAssigneeFilter =
  | { kind: 'me' }
  | { kind: 'user'; userId: string }
  | { kind: 'unassigned' };

export interface InboxFilters {
  organizationId: string;
  projectIds?: string[];
  status?: IncidentStatus[];
  severity?: Severity[];
  source?: IncidentSource[];
  /** Omitted means anyone. */
  assignee?: InboxAssigneeFilter;
  service?: string;
  technique?: string;
  /** Sigma rule id (W10 links here). */
  ruleId?: string;
  limit?: number;
  offset?: number;
}

export interface IncidentDetail {
  incident: IncidentListItem;
  detections: DetectionEvent[];
  comments: IncidentComment[];
  history: IncidentHistoryEntry[];
  sourceEvents: IncidentSourceEvent[];
}

export interface IncidentPatch {
  status?: IncidentStatus;
  /** null unassigns. */
  assigneeId?: string | null;
  severity?: Severity;
  title?: string;
  /** The API rejects null for the description. */
  description?: string;
}

export interface IncidentBulkInput {
  organizationId: string;
  ids: string[];
  action: BulkAction;
  /** Required for assign; null unassigns. */
  assigneeId?: string | null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const response = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      (body && (typeof body.error === 'string' ? body.error : body.message)) ||
      `HTTP ${response.status}`;
    const error = new Error(message) as Error & { status?: number; code?: string };
    error.status = response.status;
    if (body && typeof body.code === 'string') error.code = body.code;
    throw error;
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function buildListParams(f: InboxFilters): URLSearchParams {
  const p = new URLSearchParams({ organizationId: f.organizationId });
  for (const id of f.projectIds ?? []) p.append('projectId', id);
  for (const s of f.status ?? []) p.append('status', s);
  for (const s of f.severity ?? []) p.append('severity', s);
  for (const s of f.source ?? []) p.append('source', s);
  if (f.assignee) {
    if (f.assignee.kind === 'me') p.set('assignee', 'me');
    else if (f.assignee.kind === 'unassigned') p.set('assignee', 'unassigned');
    else p.set('assignee', f.assignee.userId);
  }
  if (f.service) p.set('service', f.service);
  if (f.technique) p.set('technique', f.technique);
  if (f.ruleId) p.set('ruleId', f.ruleId);
  if (f.limit != null) p.set('limit', String(f.limit));
  if (f.offset != null) p.set('offset', String(f.offset));
  return p;
}

export const incidentsAPI = {
  list(filters: InboxFilters): Promise<IncidentListResponse> {
    return request<IncidentListResponse>(`/api/v1/incidents?${buildListParams(filters).toString()}`);
  },

  async get(id: string, organizationId: string): Promise<IncidentDetail> {
    const params = new URLSearchParams({ organizationId });
    const data = await request<Partial<IncidentDetail> & { incident: IncidentListItem }>(
      `/api/v1/incidents/${encodeURIComponent(id)}?${params.toString()}`
    );
    return {
      incident: data.incident,
      detections: data.detections ?? [],
      comments: data.comments ?? [],
      history: data.history ?? [],
      sourceEvents: data.sourceEvents ?? [],
    };
  },

  update(id: string, organizationId: string, patch: IncidentPatch): Promise<IncidentListItem> {
    return request<IncidentListItem>(`/api/v1/incidents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      // JSON.stringify keeps an explicit null, so unassigning reaches the server.
      body: JSON.stringify({ organizationId, ...patch }),
    });
  },

  bulk(input: IncidentBulkInput): Promise<IncidentBulkResult> {
    const body: Record<string, unknown> = {
      organizationId: input.organizationId,
      ids: input.ids,
      action: input.action,
    };
    if (input.assigneeId !== undefined) body.assigneeId = input.assigneeId;
    return request<IncidentBulkResult>('/api/v1/incidents/bulk', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  addComment(id: string, organizationId: string, comment: string): Promise<IncidentComment> {
    return request<IncidentComment>(`/api/v1/incidents/${encodeURIComponent(id)}/comments`, {
      method: 'POST',
      body: JSON.stringify({ comment, organizationId }),
    });
  },

  /** Delete stays on the legacy SIEM path (F4 keeps it). */
  async remove(id: string, organizationId: string): Promise<void> {
    const params = new URLSearchParams({ organizationId });
    await request<void>(`/api/v1/siem/incidents/${encodeURIComponent(id)}?${params.toString()}`, {
      method: 'DELETE',
    });
  },
};
