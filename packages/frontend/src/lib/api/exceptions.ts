import { getApiUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';

export type {
  ExceptionLanguage,
  ErrorGroupStatus,
  StackFrameRecord,
  StackFrameRecord as StackFrame,
  ExceptionRecord,
  ErrorGroup,
  ExceptionWithFrames,
  ErrorGroupFilters,
  ErrorGroupTrendBucket,
  ErrorGroupPatch,
  ErrorGroupBulkRequest,
  ErrorGroupBulkResult,
  ErrorGroupTrendsResult,
  ErrorGroupEvent,
  ErrorGroupEventLog,
  ErrorGroupEventsResult,
  ErrorGroupTraceMatch,
  ErrorGroupSort,
  ErrorGroupBulkAction,
} from '@logtide/shared';

import type {
  ErrorGroupStatus,
  ErrorGroup,
  ExceptionWithFrames,
  ErrorGroupFilters,
  ErrorGroupTrendBucket,
  ErrorGroupPatch,
  ErrorGroupBulkRequest,
  ErrorGroupBulkResult,
  ErrorGroupTrendsResult,
  ErrorGroupEventsResult,
  ErrorGroupEventDirection,
} from '@logtide/shared';

export interface ErrorGroupLog {
  id: string;
  time: string | Date;
  service: string;
  message: string;
  traceId?: string;
  metadata?: Record<string, any>;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

async function failure(response: Response, what: string): Promise<Error> {
  const error = await response.json().catch(() => ({}));
  return new Error(error.error || `Failed to ${what} (HTTP ${response.status})`);
}

export async function getExceptionByLogId(
  logId: string,
  organizationId: string
): Promise<ExceptionWithFrames | null> {
  const token = getAuthToken();
  const searchParams = new URLSearchParams({ organizationId });

  const response = await fetch(
    `${getApiUrl()}/api/v1/exceptions/by-log/${logId}?${searchParams}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to get exception (HTTP ${response.status})`);
  }

  return response.json();
}

export async function getExceptionById(
  exceptionId: string,
  organizationId: string
): Promise<ExceptionWithFrames | null> {
  const token = getAuthToken();
  const searchParams = new URLSearchParams({ organizationId });

  const response = await fetch(`${getApiUrl()}/api/v1/exceptions/${exceptionId}?${searchParams}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to get exception (HTTP ${response.status})`);
  }

  return response.json();
}

export async function getErrorGroups(
  filters: ErrorGroupFilters
): Promise<{ groups: ErrorGroup[]; total: number }> {
  const token = getAuthToken();
  const searchParams = new URLSearchParams({
    organizationId: filters.organizationId,
  });

  if (filters.projectIds && filters.projectIds.length > 0) {
    searchParams.append('projectId', filters.projectIds.join(','));
  } else if (filters.projectId) {
    searchParams.append('projectId', filters.projectId);
  }
  if (filters.status) {
    searchParams.append('status', filters.status);
  }
  if (filters.language) {
    searchParams.append('language', filters.language);
  }
  if (filters.search) {
    searchParams.append('search', filters.search);
  }
  if (filters.from) {
    searchParams.append('from', toIso(filters.from));
  }
  if (filters.to) {
    searchParams.append('to', toIso(filters.to));
  }
  if (filters.sort) {
    searchParams.append('sort', filters.sort);
  }
  if (filters.assignedTo) {
    searchParams.append('assignedTo', filters.assignedTo);
  }
  if (filters.service) {
    searchParams.append('service', filters.service);
  }
  if (filters.limit) {
    searchParams.append('limit', filters.limit.toString());
  }
  if (filters.offset != null) {
    searchParams.append('offset', filters.offset.toString());
  }

  const response = await fetch(`${getApiUrl()}/api/v1/error-groups?${searchParams}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to get error groups (HTTP ${response.status})`);
  }

  return response.json();
}

export async function getTopErrorGroups(params: {
  organizationId: string;
  projectId?: string;
  limit?: number;
}): Promise<{ groups: ErrorGroup[] }> {
  const token = getAuthToken();
  const searchParams = new URLSearchParams({
    organizationId: params.organizationId,
  });

  if (params.projectId) {
    searchParams.append('projectId', params.projectId);
  }
  if (params.limit) {
    searchParams.append('limit', params.limit.toString());
  }

  const response = await fetch(`${getApiUrl()}/api/v1/error-groups/top?${searchParams}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to get top error groups (HTTP ${response.status})`);
  }

  return response.json();
}

export async function getErrorGroupById(
  groupId: string,
  organizationId: string
): Promise<ErrorGroup | null> {
  const token = getAuthToken();
  const searchParams = new URLSearchParams({ organizationId });

  const response = await fetch(`${getApiUrl()}/api/v1/error-groups/${groupId}?${searchParams}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to get error group (HTTP ${response.status})`);
  }

  return response.json();
}

export async function updateErrorGroupStatus(
  groupId: string,
  organizationId: string,
  status: ErrorGroupStatus
): Promise<ErrorGroup> {
  const token = getAuthToken();

  const response = await fetch(`${getApiUrl()}/api/v1/error-groups/${groupId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ organizationId, status }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to update error group status (HTTP ${response.status})`);
  }

  return response.json();
}

export interface DuplicateErrorGroup {
  id: string;
  occurrenceCount: number;
  firstSeen: string;
  lastSeen: string;
}

export async function getDuplicateErrorGroups(
  groupId: string,
  organizationId: string
): Promise<DuplicateErrorGroup[]> {
  const token = getAuthToken();
  const searchParams = new URLSearchParams({ organizationId });

  const response = await fetch(
    `${getApiUrl()}/api/v1/error-groups/${groupId}/duplicates?${searchParams}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to load duplicate groups (HTTP ${response.status})`);
  }

  const data = await response.json();
  return data.duplicates ?? [];
}

export async function mergeErrorGroups(
  groupId: string,
  sourceIds: string[],
  organizationId: string
): Promise<ErrorGroup> {
  const token = getAuthToken();

  const response = await fetch(`${getApiUrl()}/api/v1/error-groups/${groupId}/merge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ organizationId, sourceIds }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to merge error groups (HTTP ${response.status})`);
  }

  return response.json();
}

export async function getErrorGroupTrend(params: {
  groupId: string;
  organizationId: string;
  interval?: '1h' | '1d';
  days?: number;
}): Promise<{ trend: ErrorGroupTrendBucket[] }> {
  const token = getAuthToken();
  const searchParams = new URLSearchParams({
    organizationId: params.organizationId,
  });

  if (params.interval) {
    searchParams.append('interval', params.interval);
  }
  if (params.days) {
    searchParams.append('days', params.days.toString());
  }

  const response = await fetch(
    `${getApiUrl()}/api/v1/error-groups/${params.groupId}/trend?${searchParams}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to get error group trend (HTTP ${response.status})`);
  }

  return response.json();
}

export async function getErrorGroupLogs(params: {
  groupId: string;
  organizationId: string;
  limit?: number;
  offset?: number;
}): Promise<{ logs: ErrorGroupLog[]; total: number }> {
  const token = getAuthToken();
  const searchParams = new URLSearchParams({
    organizationId: params.organizationId,
  });

  if (params.limit) {
    searchParams.append('limit', params.limit.toString());
  }
  if (params.offset) {
    searchParams.append('offset', params.offset.toString());
  }

  const response = await fetch(
    `${getApiUrl()}/api/v1/error-groups/${params.groupId}/logs?${searchParams}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to get error group logs (HTTP ${response.status})`);
  }

  return response.json();
}

export async function hasException(logId: string, organizationId: string): Promise<boolean> {
  const exception = await getExceptionByLogId(logId, organizationId);
  return exception !== null;
}

export async function getErrorGroupTrends(params: {
  organizationId: string;
  ids: string[];
  from: Date | string;
  to: Date | string;
  buckets?: number;
}): Promise<ErrorGroupTrendsResult> {
  const token = getAuthToken();
  const searchParams = new URLSearchParams({
    organizationId: params.organizationId,
    ids: params.ids.join(','),
    from: toIso(params.from),
    to: toIso(params.to),
  });
  if (params.buckets) {
    searchParams.append('buckets', params.buckets.toString());
  }

  const response = await fetch(`${getApiUrl()}/api/v1/error-groups/trends?${searchParams}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) throw await failure(response, 'get error trends');
  return response.json();
}

export async function getErrorGroupEvents(params: {
  groupId: string;
  organizationId: string;
  cursor?: string;
  direction?: ErrorGroupEventDirection;
  limit?: number;
}): Promise<ErrorGroupEventsResult> {
  const token = getAuthToken();
  const searchParams = new URLSearchParams({ organizationId: params.organizationId });
  if (params.cursor) searchParams.append('cursor', params.cursor);
  if (params.direction) searchParams.append('direction', params.direction);
  if (params.limit) searchParams.append('limit', params.limit.toString());

  const response = await fetch(
    `${getApiUrl()}/api/v1/error-groups/${params.groupId}/events?${searchParams}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!response.ok) throw await failure(response, 'get error events');
  return response.json();
}

export async function updateErrorGroup(
  groupId: string,
  organizationId: string,
  patch: ErrorGroupPatch
): Promise<ErrorGroup> {
  const token = getAuthToken();

  const response = await fetch(`${getApiUrl()}/api/v1/error-groups/${groupId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ organizationId, ...patch }),
  });

  if (!response.ok) throw await failure(response, 'update error group');
  return response.json();
}

export async function bulkUpdateErrorGroups(
  req: ErrorGroupBulkRequest
): Promise<ErrorGroupBulkResult> {
  const token = getAuthToken();

  const response = await fetch(`${getApiUrl()}/api/v1/error-groups/bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(req),
  });

  if (!response.ok) throw await failure(response, 'update error groups');
  return response.json();
}
