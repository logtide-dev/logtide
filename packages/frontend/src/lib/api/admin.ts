import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { get } from 'svelte/store';
import { authStore } from '$lib/stores/auth';
import { getApiBaseUrl } from '$lib/config';

export interface SystemStats {
    users: {
        total: number;
        growth: {
            today: number;
            week: number;
            month: number;
        };
        active: number;
    };
    organizations: {
        total: number;
        growth: {
            today: number;
            week: number;
            month: number;
        };
    };
    projects: {
        total: number;
        growth: {
            today: number;
            week: number;
            month: number;
        };
    };
}

export interface DatabaseStats {
    tables: Array<{
        name: string;
        size: string;
        rows: number;
        indexes_size: string;
    }>;
    totalSize: string;
    totalRows: number;
}

export interface LogsStats {
    total: number;
    perDay: Array<{
        date: string;
        count: number;
    }>;
    topOrganizations: Array<{
        organizationId: string;
        organizationName: string;
        count: number;
    }>;
    topProjects: Array<{
        projectId: string;
        projectName: string;
        organizationName: string;
        count: number;
    }>;
    growth: {
        logsPerHour: number;
        logsPerDay: number;
    };
}

export interface PerformanceStats {
    ingestion: {
        throughput: number;
        avgLatency: number;
    };
    storage: {
        logsSize: string;
        compressionRatio: number;
    };
}

export interface AlertsStats {
    rules: {
        total: number;
        active: number;
        disabled: number;
    };
    triggered: {
        last24h: number;
        last7days: number;
    };
    perOrganization: Array<{
        organizationId: string;
        organizationName: string;
        rulesCount: number;
    }>;
    notifications: {
        success: number;
        failed: number;
    };
}

export interface RedisStats {
    memory: {
        used: string;
        peak: string;
    };
    queues: {
        alertNotifications: {
            waiting: number;
            active: number;
            completed: number;
            failed: number;
        };
        sigmaDetection: {
            waiting: number;
            active: number;
            completed: number;
            failed: number;
        };
    };
    connections: number;
}

export interface HealthStats {
    storageEngine: 'timescale' | 'clickhouse' | 'mongodb';
    database: {
        status: 'healthy' | 'degraded' | 'down';
        latency: number;
        connections: number;
    };
    clickhouse?: {
        status: 'healthy' | 'degraded' | 'down';
        latency: number;
    };
    mongodb?: {
        status: 'healthy' | 'degraded' | 'down';
        latency: number;
    };
    redis: {
        status: 'healthy' | 'degraded' | 'down' | 'not_configured';
        latency: number;
    };
    pool: {
        totalConnections: number;
        idleConnections: number;
        waitingRequests: number;
    };
    overall: 'healthy' | 'degraded' | 'down';
}

// User Management Interfaces
export interface UserBasic {
    id: string;
    email: string;
    name: string;
    is_admin: boolean;
    disabled: boolean;
    created_at: string;
    last_login: string | null;
}

export interface UserDetails extends UserBasic {
    updated_at: string;
    organizations: Array<{
        id: string;
        name: string;
        slug: string;
        role: string;
        created_at: string;
    }>;
    activeSessions: number;
}

export interface UsersListResponse {
    users: UserBasic[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

// Organization Management Interfaces
export interface OrganizationBasic {
    id: string;
    name: string;
    slug: string;
    created_at: string;
    updated_at: string;
    memberCount: number;
    projectCount: number;
}

export interface OrganizationDetails {
    id: string;
    name: string;
    slug: string;
    retentionDays: number;
    auditRetentionDays: number | null;
    created_at: string;
    updated_at: string;
    members: Array<{
        id: string;
        email: string;
        name: string;
        role: string;
        created_at: string;
    }>;
    projects: Array<{
        id: string;
        name: string;
        created_at: string;
    }>;
}

export interface OrganizationsListResponse {
    organizations: OrganizationBasic[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

// Capability entitlements (#214)
export type EntitlementValue =
    | { kind: 'boolean'; enabled: boolean }
    | { kind: 'limit'; limit: number | null }
    | { kind: 'quota'; limit: number | null };

export type EntitlementMap = Record<string, EntitlementValue>;

export interface EntitlementUpdate {
    capability: string;
    enabled?: boolean;
    limitValue?: number | null;
}

// Project Management Interfaces
export interface ProjectBasic {
    id: string;
    name: string;
    description: string | null;
    organization_id: string;
    organization_name: string;
    created_at: string;
    updated_at: string;
    /** Logs in the last 30 days (same value as logs30d, historical name). */
    logsCount: number;
    logs30d?: number;
    apiKeysCount: number;
    alertRulesCount: number;
}

export interface ProjectDetails {
    id: string;
    name: string;
    description: string | null;
    organization_id: string;
    organization_name: string;
    created_at: string;
    updated_at: string;
    /** Soft-delete time; the project is in the trash when set. */
    deletedAt?: string | null;
    /** Logs in the last `logsWindowDays` days (same value as logs30d). */
    logsCount: number;
    logs30d?: number;
    logsWindowDays?: number;
    apiKeys: Array<{
        id: string;
        name: string;
        type: 'write' | 'full';
        allowed_origins: string[] | null;
        created_at: string;
        last_used: string | null;
        revoked: boolean;
    }>;
    alertRules: Array<{
        id: string;
        name: string;
        enabled: boolean;
        created_at: string;
    }>;
    sigmaRules: Array<{
        id: string;
        title: string;
        level: string | null;
        status: string | null;
        created_at: string;
    }>;
    lastLogTime: string | null;
}

export interface ProjectsListResponse {
    projects: ProjectBasic[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

// Platform Timeline
export interface PlatformTimeline {
    timeline: Array<{
        bucket: string;
        logsCount: number;
        detectionsCount: number;
        spansCount: number;
        metricsCount: number;
    }>;
}

// Active Issues
export interface ActiveIssues {
    openIncidents: number;
    criticalDetections24h: number;
    failedNotifications24h: number;
    openErrorGroups: number;
}

// Compression Stats
export interface CompressionStatsItem {
    hypertable: string;
    totalChunks: number;
    compressedChunks: number;
    uncompressedSizeBytes: number;
    compressedSizeBytes: number;
    compressionRatio: number;
    spaceSavedBytes: number;
    spaceSavedPretty: string;
}

export interface CompressionStatsResponse {
    hypertables: CompressionStatsItem[];
}

// Continuous Aggregates Health
export interface AggregateStatsItem {
    viewName: string;
    hypertableName: string;
    lastRefresh: string | null;
    refreshInterval: string;
    totalRows: number;
}

export interface AggregatesResponse {
    aggregates: AggregateStatsItem[];
}

// Slow Queries
export interface SlowQueriesStats {
    activeQueries: Array<{
        pid: number;
        durationMs: number;
        state: string;
        query: string;
        waitEvent: string | null;
        applicationName: string;
        startedAt: string;
    }>;
    topSlowQueries: Array<{
        query: string;
        calls: number;
        avg_ms: number;
        total_ms: number;
        rows_per_call: number;
    }>;
    pgStatStatementsAvailable: boolean;
}

// Version Check
export interface ReleaseInfo {
    version: string;
    tag: string;
    name: string;
    publishedAt: string;
    url: string;
    prerelease: boolean;
}

export interface VersionCheckResult {
    currentVersion: string;
    channel: 'stable' | 'beta';
    latestStable: ReleaseInfo | null;
    latestBeta: ReleaseInfo | null;
    updateAvailable: boolean;
    checkedAt: string;
}

export interface EnrichmentSourceStatus {
    configured: boolean;
    ready: boolean;
    lastUpdate: string | null;
    source: string;
}

export interface IngestionHealthStats {
    counters24h: {
        piiRejected: number;
        detectionEnqueueFailed: number;
        exceptionEnqueueFailed: number;
        identifierFailed: number;
        timestampSkew: number;
        spanTimestampSkew: number;
        metricTimestampSkew: number;
    };
    enrichment: {
        ipReputation: EnrichmentSourceStatus & { totalIps: number };
        geoIp: EnrichmentSourceStatus;
    };
}

// System Settings Interfaces
export interface SystemSetting {
    key: string;
    value: unknown;
    description: string | null;
    updated_at: string;
    updated_by: string | null;
}

export interface AuthSettings {
    'auth.signup_enabled': boolean;
    'auth.mode': 'standard' | 'none';
    'auth.default_user_id': string | null;
}

/** Default and explicit-override view of an org's entitlements. */
export interface EntitlementOverride {
    enabled: boolean | null;
    limitValue: number | null;
}

export interface EntitlementsResponse {
    entitlements: EntitlementMap;
    defaults?: EntitlementMap;
    overrides?: Record<string, EntitlementOverride>;
}

/**
 * Read the error text from a failed response. The backend sends `{ error }`
 * (sometimes `{ message }`); the body may also be empty or not JSON at all.
 */
export async function readApiError(response: Response, fallback: string): Promise<string> {
    let text = '';
    try {
        text = await response.text();
    } catch {
        return fallback;
    }
    if (!text) return fallback;
    try {
        const body = JSON.parse(text) as { error?: unknown; message?: unknown };
        const msg = body?.error ?? body?.message;
        if (typeof msg === 'string' && msg.trim()) return msg;
        return fallback;
    } catch {
        return fallback;
    }
}

/** Parse a success body, tolerating 204 / empty / non-JSON responses. */
async function readJson<T>(response: Response): Promise<T> {
    const text = await response.text().catch(() => '');
    if (!text) return {} as T;
    try {
        return JSON.parse(text) as T;
    } catch {
        return {} as T;
    }
}

export class AdminAPI {
    private token(): string {
        const token = get(authStore).token;
        if (!token) {
            goto('/login');
            throw new Error('No token found');
        }
        return token;
    }

    private async fetch<T>(endpoint: string): Promise<T> {
        if (!browser) return {} as T;

        const token = this.token();

        const response = await fetch(`${getApiBaseUrl()}/admin${endpoint}`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (response.status === 401) {
            goto('/login');
            throw new Error('Unauthorized');
        }

        if (response.status === 403) {
            goto('/dashboard');
            throw new Error('Forbidden');
        }

        if (!response.ok) {
            throw new Error(await readApiError(response, 'API request failed'));
        }

        return readJson<T>(response);
    }

    /** Mutation helper: surfaces the backend error text on failure. */
    private async send<T>(method: string, endpoint: string, body: unknown, fallback: string): Promise<T> {
        const token = this.token();
        const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
        if (body !== undefined) headers['Content-Type'] = 'application/json';

        const response = await fetch(`${getApiBaseUrl()}/admin${endpoint}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
        });

        if (response.status === 401) {
            goto('/login');
            throw new Error('Unauthorized');
        }

        if (!response.ok) {
            throw new Error(await readApiError(response, fallback));
        }

        return readJson<T>(response);
    }

    async getSystemStats(): Promise<SystemStats> {
        return this.fetch<SystemStats>('/stats/system');
    }

    async getDatabaseStats(): Promise<DatabaseStats> {
        return this.fetch<DatabaseStats>('/stats/database');
    }

    async getLogsStats(): Promise<LogsStats> {
        return this.fetch<LogsStats>('/stats/logs');
    }

    async getPerformanceStats(): Promise<PerformanceStats> {
        return this.fetch<PerformanceStats>('/stats/performance');
    }

    async getAlertsStats(): Promise<AlertsStats> {
        return this.fetch<AlertsStats>('/stats/alerts');
    }

    async getRedisStats(): Promise<RedisStats> {
        return this.fetch<RedisStats>('/stats/redis');
    }

    async getHealthStats(): Promise<HealthStats> {
        return this.fetch<HealthStats>('/stats/health');
    }

    // New dashboard endpoints
    async getPlatformTimeline(hours: number = 24): Promise<PlatformTimeline> {
        return this.fetch<PlatformTimeline>(`/stats/platform-timeline?hours=${hours}`);
    }

    async getActiveIssues(): Promise<ActiveIssues> {
        return this.fetch<ActiveIssues>('/stats/active-issues');
    }

    async getCompressionStats(): Promise<CompressionStatsResponse> {
        return this.fetch<CompressionStatsResponse>('/stats/compression');
    }

    async getContinuousAggregates(): Promise<AggregatesResponse> {
        return this.fetch<AggregatesResponse>('/stats/continuous-aggregates');
    }

    async getSlowQueries(): Promise<SlowQueriesStats> {
        return this.fetch<SlowQueriesStats>('/stats/slow-queries');
    }

    async getVersionCheck(): Promise<VersionCheckResult> {
        return this.fetch<VersionCheckResult>('/version-check');
    }

    async getIngestionHealth(): Promise<IngestionHealthStats> {
        return this.fetch<IngestionHealthStats>('/stats/ingestion-health');
    }

    // User Management
    async getUsers(page: number = 1, limit: number = 50, search?: string): Promise<UsersListResponse> {
        const params = new URLSearchParams({
            page: page.toString(),
            limit: limit.toString(),
        });
        if (search) {
            params.append('search', search);
        }
        return this.fetch<UsersListResponse>(`/users?${params.toString()}`);
    }

    async getUserDetails(userId: string): Promise<UserDetails> {
        return this.fetch<UserDetails>(`/users/${userId}`);
    }

    async createUser(input: {
        email: string;
        name: string;
        password: string;
        is_admin?: boolean;
    }): Promise<{ message: string; user: UserBasic }> {
        return this.send('POST', '/users', input, 'Failed to create user');
    }

    async updateUserStatus(userId: string, disabled: boolean): Promise<{ message: string; user: UserBasic }> {
        return this.send('PATCH', `/users/${userId}/status`, { disabled }, 'Failed to update user status');
    }

    async updateUserRole(userId: string, isAdmin: boolean): Promise<{ message: string; user: UserBasic }> {
        return this.send('PATCH', `/users/${userId}/role`, { is_admin: isAdmin }, 'Failed to update user role');
    }

    async resetUserPassword(userId: string, newPassword: string): Promise<{ message: string; user: UserBasic }> {
        return this.send('POST', `/users/${userId}/reset-password`, { newPassword }, 'Failed to reset password');
    }

    // Organization Management
    async getOrganizations(page: number = 1, limit: number = 50, search?: string): Promise<OrganizationsListResponse> {
        const params = new URLSearchParams({
            page: page.toString(),
            limit: limit.toString(),
        });
        if (search) {
            params.append('search', search);
        }
        return this.fetch<OrganizationsListResponse>(`/organizations?${params.toString()}`);
    }

    async getOrganizationDetails(orgId: string): Promise<OrganizationDetails> {
        return this.fetch<OrganizationDetails>(`/organizations/${orgId}`);
    }

    async getOrganizationEntitlements(orgId: string): Promise<EntitlementsResponse> {
        return this.fetch<EntitlementsResponse>(`/organizations/${orgId}/entitlements`);
    }

    async deleteOrganization(orgId: string): Promise<{ message: string }> {
        return this.send('DELETE', `/organizations/${orgId}`, undefined, 'Failed to delete organization');
    }

    async updateOrganizationRetention(
        orgId: string,
        opts: { retentionDays?: number; auditRetentionDays?: number | null }
    ): Promise<{ message: string; success: boolean; retentionDays: number }> {
        return this.send('PUT', `/organizations/${orgId}/retention`, opts, 'Failed to update retention policy');
    }

    async updateOrganizationEntitlements(
        orgId: string,
        entitlements: EntitlementUpdate[]
    ): Promise<{ message: string; updated: number }> {
        return this.send('PUT', `/organizations/${orgId}/entitlements`, { entitlements }, 'Failed to update entitlements');
    }

    /** Remove an explicit override so the org inherits the default again. */
    async resetOrganizationEntitlement(orgId: string, capability: string): Promise<{ removed: boolean }> {
        return this.send(
            'DELETE',
            `/organizations/${orgId}/entitlements/${encodeURIComponent(capability)}`,
            undefined,
            'Failed to reset entitlement'
        );
    }

    // Project Management
    async getProjects(page: number = 1, limit: number = 50, search?: string): Promise<ProjectsListResponse> {
        const params = new URLSearchParams({
            page: page.toString(),
            limit: limit.toString(),
        });
        if (search) {
            params.append('search', search);
        }
        return this.fetch<ProjectsListResponse>(`/projects?${params.toString()}`);
    }

    async getProjectDetails(projectId: string): Promise<ProjectDetails> {
        return this.fetch<ProjectDetails>(`/projects/${projectId}`);
    }

    async deleteProject(projectId: string): Promise<{ message: string }> {
        return this.send('DELETE', `/projects/${projectId}`, undefined, 'Failed to delete project');
    }

    // System Settings
    async getSettings(): Promise<Record<string, unknown>> {
        const response = await this.fetch<{ settings: Record<string, unknown> }>('/settings');
        return response.settings;
    }

    async getSetting(key: string): Promise<{ key: string; value: unknown; description: string | null }> {
        return this.fetch<{ key: string; value: unknown; description: string | null }>(`/settings/${encodeURIComponent(key)}`);
    }

    async updateSettings(settings: Record<string, unknown>): Promise<{ success: boolean; settings: Record<string, unknown> }> {
        return this.send('PATCH', '/settings', settings, 'Failed to update settings');
    }
}

export const adminAPI = new AdminAPI();
