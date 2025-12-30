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
    database: {
        status: 'up' | 'down';
        latency: number;
        connections: number;
    };
    redis: {
        status: 'up' | 'down';
        latency: number;
    };
    overall: 'up' | 'down';
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

// Project Management Interfaces
export interface ProjectBasic {
    id: string;
    name: string;
    description: string | null;
    organization_id: string;
    organization_name: string;
    created_at: string;
    updated_at: string;
    logsCount: number;
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
    logsCount: number;
    apiKeys: Array<{
        id: string;
        name: string;
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

class AdminAPI {
    private async fetch<T>(endpoint: string): Promise<T> {
        if (!browser) return {} as T;

        const token = get(authStore).token;
        if (!token) {
            goto('/login');
            throw new Error('No token found');
        }

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
            const error = await response.json();
            throw new Error(error.message || 'API request failed');
        }

        return response.json();
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

    async updateUserStatus(userId: string, disabled: boolean): Promise<{ message: string; user: UserBasic }> {
        const auth = get(authStore);
        const token = auth.token;

        if (!token) {
            goto('/login');
            throw new Error('No token found');
        }

        const response = await fetch(`${getApiBaseUrl()}/admin/users/${userId}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ disabled }),
        });

        if (!response.ok) {
            throw new Error('Failed to update user status');
        }

        return response.json();
    }

    async updateUserRole(userId: string, isAdmin: boolean): Promise<{ message: string; user: UserBasic }> {
        const auth = get(authStore);
        const token = auth.token;

        if (!token) {
            goto('/login');
            throw new Error('No token found');
        }

        const response = await fetch(`${getApiBaseUrl()}/admin/users/${userId}/role`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ is_admin: isAdmin }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update user role');
        }

        return response.json();
    }

    async resetUserPassword(userId: string, newPassword: string): Promise<{ message: string; user: UserBasic }> {
        const auth = get(authStore);
        const token = auth.token;

        if (!token) {
            goto('/login');
            throw new Error('No token found');
        }

        const response = await fetch(`${getApiBaseUrl()}/admin/users/${userId}/reset-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ newPassword }),
        });

        if (!response.ok) {
            throw new Error('Failed to reset password');
        }

        return response.json();
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

    async deleteOrganization(orgId: string): Promise<{ message: string }> {
        const auth = get(authStore);
        const token = auth.token;

        if (!token) {
            goto('/login');
            throw new Error('No token found');
        }

        const response = await fetch(`${getApiBaseUrl()}/admin/organizations/${orgId}`, {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            throw new Error('Failed to delete organization');
        }

        return response.json();
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
        const auth = get(authStore);
        const token = auth.token;

        if (!token) {
            goto('/login');
            throw new Error('No token found');
        }

        const response = await fetch(`${getApiBaseUrl()}/admin/projects/${projectId}`, {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            throw new Error('Failed to delete project');
        }

        return response.json();
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
        const auth = get(authStore);
        const token = auth.token;

        if (!token) {
            goto('/login');
            throw new Error('No token found');
        }

        const response = await fetch(`${getApiBaseUrl()}/admin/settings`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(settings),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update settings');
        }

        return response.json();
    }
}

export const adminAPI = new AdminAPI();
