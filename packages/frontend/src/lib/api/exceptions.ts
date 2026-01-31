import { getApiUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';

export type {
  ExceptionLanguage,
  ErrorGroupStatus,
  StackFrameRecord,
  ExceptionRecord,
  ErrorGroup,
  ExceptionWithFrames,
  ErrorGroupFilters,
  ErrorGroupTrendBucket,
} from '@logtide/shared';

import type {
  ExceptionLanguage,
  ErrorGroupStatus,
  StackFrameRecord,
  ExceptionRecord,
  ErrorGroup,
  ExceptionWithFrames,
  ErrorGroupFilters,
  ErrorGroupTrendBucket,
} from '@logtide/shared';

export interface ErrorGroupLog {
  id: string;
  time: string;
  service: string;
  message: string;
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
    const error = await response.json();
    throw new Error(error.error || 'Failed to get exception');
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
    const error = await response.json();
    throw new Error(error.error || 'Failed to get exception');
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

  if (filters.projectId) {
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
  if (filters.limit) {
    searchParams.append('limit', filters.limit.toString());
  }
  if (filters.offset) {
    searchParams.append('offset', filters.offset.toString());
  }

  const response = await fetch(`${getApiUrl()}/api/v1/error-groups?${searchParams}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get error groups');
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
    const error = await response.json();
    throw new Error(error.error || 'Failed to get top error groups');
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
    const error = await response.json();
    throw new Error(error.error || 'Failed to get error group');
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
    const error = await response.json();
    throw new Error(error.error || 'Failed to update error group status');
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
    const error = await response.json();
    throw new Error(error.error || 'Failed to get error group trend');
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
    const error = await response.json();
    throw new Error(error.error || 'Failed to get error group logs');
  }

  return response.json();
}

export async function hasException(logId: string, organizationId: string): Promise<boolean> {
  const exception = await getExceptionByLogId(logId, organizationId);
  return exception !== null;
}
