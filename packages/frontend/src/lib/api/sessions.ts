import { getApiBaseUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';
import { errorTextOf } from '$lib/api/metrics';

export interface SessionSummary {
  sessionId: string;
  service: string;
  firstEvent: string;
  lastEvent: string;
  durationMs: number;
  eventCount: number;
  errorCount: number;
  browser?: string;
  os?: string;
  device?: 'desktop' | 'mobile' | 'tablet';
  entryUrl?: string;
  user?: string;
}

/** Cursor pagination: no total, pass `nextCursor` back as `cursor` for the next page. */
export interface SessionsResponse {
  sessions: SessionSummary[];
  nextCursor?: string;
}

export interface SessionEvent {
  id: string;
  time: string;
  service: string;
  level: string;
  message: string;
  metadata?: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
  sessionId?: string;
  errorGroupId?: string;
}

export interface SessionEventsResponse {
  events: SessionEvent[];
  window: { from: string; to: string } | null;
  truncated: boolean;
}

interface ListSessionsParams {
  projectId: string;
  from?: string;
  to?: string;
  hasErrors?: boolean;
  service?: string;
  limit?: number;
  cursor?: string;
}

interface GetSessionEventsParams {
  projectId: string;
  sessionId: string;
  limit?: number;
}

class SessionsAPI {
  constructor(private getToken: () => string | null) {}

  private getHeaders(): HeadersInit {
    const token = this.getToken();
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  async listSessions(params: ListSessionsParams): Promise<SessionsResponse> {
    const qs = new URLSearchParams();
    qs.append('projectId', params.projectId);
    if (params.from) qs.append('from', params.from);
    if (params.to) qs.append('to', params.to);
    if (params.hasErrors !== undefined) qs.append('hasErrors', String(params.hasErrors));
    if (params.service) qs.append('service', params.service);
    if (params.limit) qs.append('limit', String(params.limit));
    if (params.cursor) qs.append('cursor', params.cursor);

    const response = await fetch(`${getApiBaseUrl()}/sessions?${qs}`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(await errorTextOf(response, 'Failed to fetch sessions'));
    }

    return response.json();
  }

  async getSessionEvents(params: GetSessionEventsParams): Promise<SessionEventsResponse> {
    const qs = new URLSearchParams();
    qs.append('projectId', params.projectId);
    if (params.limit) qs.append('limit', String(params.limit));

    const response = await fetch(
      `${getApiBaseUrl()}/sessions/${encodeURIComponent(params.sessionId)}/events?${qs}`,
      { headers: this.getHeaders() },
    );

    if (!response.ok) {
      throw new Error(await errorTextOf(response, 'Failed to fetch session events'));
    }

    return response.json();
  }
}

export const sessionsAPI = new SessionsAPI(getAuthToken);
