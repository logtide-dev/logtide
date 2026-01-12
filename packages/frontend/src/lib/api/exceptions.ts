import { getApiUrl } from '$lib/config';

// ============================================================================
// TYPES
// ============================================================================

export type ExceptionLanguage = 'nodejs' | 'python' | 'java' | 'go' | 'php' | 'unknown';
export type ErrorGroupStatus = 'open' | 'resolved' | 'ignored';

export interface StackFrame {
    id: string;
    exceptionId: string;
    frameIndex: number;
    filePath: string;
    functionName: string | null;
    lineNumber: number | null;
    columnNumber: number | null;
    isAppCode: boolean;
    codeContext: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
}

export interface Exception {
    id: string;
    organizationId: string;
    projectId: string | null;
    logId: string;
    exceptionType: string;
    exceptionMessage: string | null;
    language: ExceptionLanguage;
    fingerprint: string;
    rawStackTrace: string;
    frameCount: number;
    createdAt: string;
}

export interface ExceptionWithFrames {
    exception: Exception;
    frames: StackFrame[];
}

export interface ErrorGroup {
    id: string;
    organizationId: string;
    projectId: string | null;
    fingerprint: string;
    exceptionType: string;
    exceptionMessage: string | null;
    language: ExceptionLanguage;
    occurrenceCount: number;
    firstSeen: string;
    lastSeen: string;
    status: ErrorGroupStatus;
    resolvedAt: string | null;
    resolvedBy: string | null;
    affectedServices: string[];
    sampleLogId: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ErrorGroupTrendBucket {
    timestamp: string;
    count: number;
}

export interface ErrorGroupFilters {
    organizationId: string;
    projectId?: string;
    status?: ErrorGroupStatus;
    language?: ExceptionLanguage;
    search?: string;
    limit?: number;
    offset?: number;
}

export interface ErrorGroupLog {
    id: string;
    time: string;
    service: string;
    message: string;
}

// ============================================================================
// API CLIENT
// ============================================================================

/**
 * Get auth token from localStorage
 */
function getToken(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        const stored = localStorage.getItem('logtide_auth');
        if (stored) {
            const data = JSON.parse(stored);
            return data.token;
        }
    } catch (e) {
        console.error('Failed to get token:', e);
    }
    return null;
}

/**
 * Get exception details by log ID
 */
export async function getExceptionByLogId(
    logId: string,
    organizationId: string
): Promise<ExceptionWithFrames | null> {
    const token = getToken();
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

/**
 * Get exception details by exception ID
 */
export async function getExceptionById(
    exceptionId: string,
    organizationId: string
): Promise<ExceptionWithFrames | null> {
    const token = getToken();
    const searchParams = new URLSearchParams({ organizationId });

    const response = await fetch(
        `${getApiUrl()}/api/v1/exceptions/${exceptionId}?${searchParams}`,
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

/**
 * List error groups with filters
 */
export async function getErrorGroups(
    filters: ErrorGroupFilters
): Promise<{ groups: ErrorGroup[]; total: number }> {
    const token = getToken();
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

/**
 * Get top error groups for dashboard widget
 */
export async function getTopErrorGroups(params: {
    organizationId: string;
    projectId?: string;
    limit?: number;
}): Promise<{ groups: ErrorGroup[] }> {
    const token = getToken();
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

/**
 * Get error group by ID
 */
export async function getErrorGroupById(
    groupId: string,
    organizationId: string
): Promise<ErrorGroup | null> {
    const token = getToken();
    const searchParams = new URLSearchParams({ organizationId });

    const response = await fetch(
        `${getApiUrl()}/api/v1/error-groups/${groupId}?${searchParams}`,
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
        throw new Error(error.error || 'Failed to get error group');
    }

    return response.json();
}

/**
 * Update error group status
 */
export async function updateErrorGroupStatus(
    groupId: string,
    organizationId: string,
    status: ErrorGroupStatus
): Promise<ErrorGroup> {
    const token = getToken();

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

/**
 * Get error group trend (time-series data)
 */
export async function getErrorGroupTrend(params: {
    groupId: string;
    organizationId: string;
    interval?: '1h' | '1d';
    days?: number;
}): Promise<{ trend: ErrorGroupTrendBucket[] }> {
    const token = getToken();
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

/**
 * Get logs associated with an error group
 */
export async function getErrorGroupLogs(params: {
    groupId: string;
    organizationId: string;
    limit?: number;
    offset?: number;
}): Promise<{ logs: ErrorGroupLog[]; total: number }> {
    const token = getToken();
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

/**
 * Check if a log has an associated exception
 */
export async function hasException(logId: string, organizationId: string): Promise<boolean> {
    const exception = await getExceptionByLogId(logId, organizationId);
    return exception !== null;
}
