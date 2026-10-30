import { getApiUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';
import type {
    DetectionEvent,
    CreateExceptionInput,
    SigmaException,
    SigmaRuleDetail,
    SigmaRuleListItem,
    SigmaRuleListQuery,
    SigmaRulePreviewResult,
} from '@logtide/shared';

/** Error carrying the HTTP status so callers can tell a 429 from a 400. */
export class SigmaApiError extends Error {
    readonly status: number;
    readonly code?: string;

    constructor(message: string, status: number, code?: string) {
        super(message);
        this.name = 'SigmaApiError';
        this.status = status;
        this.code = code;
    }
}

export interface ImportSigmaRuleParams {
    yaml: string;
    organizationId: string;
    projectId?: string;
    emailRecipients?: string[];
    webhookUrl?: string;
    channelIds?: string[];
}

export interface SigmaRule {
    id: string;
    title: string;
    description?: string;
    level?: 'informational' | 'low' | 'medium' | 'high' | 'critical';
    status?: 'experimental' | 'test' | 'stable' | 'deprecated' | 'unsupported';
    author?: string;
    date?: string;
    logsource: Record<string, any>;
    detection: Record<string, any>;
    alertRuleId?: string;
    conversionStatus?: 'success' | 'partial' | 'failed';
    conversionNotes?: string;
    tags?: string[];
    mitreTactics?: string[];
    mitreTechniques?: string[];
    source?: 'custom' | 'sigmahq' | 'pack';
    packId?: string | null;
    hits7d?: number;
    lastFiredAt?: string | null;
    exceptionCount?: number;
    sigmahqPath?: string;
    sigmahqCommit?: string;
    lastSyncedAt?: string;
    createdAt: string;
    updatedAt: string;
}

export interface SigmaCategory {
    name: string;
    path: string;
    ruleCount: number;
    subcategories?: string[];
}

export interface CategoryTreeNode {
    name: string;
    path: string;
    type: 'category';
    ruleCount: number;
    children?: CategoryTreeNode[];
}

export interface SigmaRuleMetadata {
    path: string;
    name: string;
    title?: string;
    level?: string;
    description?: string;
    tags?: string[];
    category: string;
    downloadUrl: string;
    sha: string;
}

export interface SyncSigmaParams {
    organizationId: string;
    projectId?: string;
    category?: string; // Legacy
    selection?: {
        // New: granular selection
        categories?: string[];
        rules?: string[];
    };
    limit?: number;
    autoCreateAlerts?: boolean;
    emailRecipients?: string[];
    webhookUrl?: string;
    channelIds?: string[];
}

export interface SyncResult {
    success: boolean;
    imported: number;
    failed: number;
    skipped: number;
    errors: Array<{ rule: string; error: string }>;
    warnings: string[];
    commitHash: string;
}

export interface SyncStatus {
    organizationId: string;
    lastSyncedAt: string | null;
    totalRules: number;
    syncedRules: number;
    failedRules: number;
    nextScheduledSync: string | null;
}

export interface MITRETactic {
    id: string;
    name: string;
    description: string;
}

export interface ImportSigmaRuleResponse {
    sigmaRule: SigmaRule;
    alertRule?: any;
    warnings: string[];
    errors: string[];
}

export class SigmaAPI {
    private getToken: () => string | null;

    constructor(getToken: () => string | null) {
        this.getToken = getToken;
    }

    private async request(endpoint: string, options: RequestInit = {}) {
        const token = this.getToken();

        const response = await fetch(`${getApiUrl()}${endpoint}`, {
            ...options,
            headers: {
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...options.headers,
            },
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Request failed' }));

            // Handle different error formats
            let errorMessage = errorData.error || errorData.message || `HTTP ${response.status}`;

            // Add validation details if available
            if (errorData.details && Array.isArray(errorData.details)) {
                const detailMessages = errorData.details.map((d: any) =>
                    `${d.path?.join('.')}: ${d.message}`
                ).join(', ');
                errorMessage += ` - ${detailMessages}`;
            }

            throw new SigmaApiError(errorMessage, response.status, errorData.code);
        }

        if (response.status === 204) {
            return null;
        }

        return response.json();
    }

    async importRule(data: ImportSigmaRuleParams): Promise<ImportSigmaRuleResponse> {
        return this.request('/api/v1/sigma/import', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async getRules(organizationId: string): Promise<{ rules: SigmaRule[] }> {
        const queryParams = new URLSearchParams({ organizationId });
        return this.request(`/api/v1/sigma/rules?${queryParams.toString()}`);
    }

    async getRule(id: string, organizationId: string): Promise<{ rule: SigmaRule }> {
        const queryParams = new URLSearchParams({ organizationId });
        return this.request(`/api/v1/sigma/rules/${id}?${queryParams.toString()}`);
    }

    async deleteRule(
        id: string,
        organizationId: string,
        deleteAlertRule: boolean = false
    ): Promise<void> {
        const queryParams = new URLSearchParams({
            organizationId,
            deleteAlertRule: deleteAlertRule.toString(),
        });

        return this.request(`/api/v1/sigma/rules/${id}?${queryParams.toString()}`, {
            method: 'DELETE',
        });
    }

    async updateRule(
        id: string,
        data: {
            organizationId: string;
            enabled?: boolean;
            channelIds?: string[];
        }
    ): Promise<{ rule: SigmaRule }> {
        return this.request(`/api/v1/sigma/rules/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    }

    // Detection rules table, detail, bulk, YAML, matches, preview, exceptions

    async listRules(q: SigmaRuleListQuery): Promise<{
        rules: SigmaRuleListItem[];
        total: number;
        page: number;
        pageSize: number;
    }> {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(q)) {
            if (value === undefined || value === null || value === '') continue;
            if (Array.isArray(value)) {
                if (value.length === 0) continue;
                params.set(key, value.join(','));
            } else {
                params.set(key, String(value));
            }
        }
        return this.request(`/api/v1/sigma/rules?${params.toString()}`);
    }

    async getRuleDetail(id: string, organizationId: string): Promise<{ rule: SigmaRuleDetail }> {
        const params = new URLSearchParams({ organizationId });
        return this.request(`/api/v1/sigma/rules/${id}?${params.toString()}`);
    }

    async bulk(
        organizationId: string,
        ids: string[],
        action: 'enable' | 'disable' | 'delete'
    ): Promise<{ affected: number }> {
        return this.request('/api/v1/sigma/rules/bulk', {
            method: 'POST',
            body: JSON.stringify({ organizationId, ids, action }),
        });
    }

    async validateYaml(
        organizationId: string,
        yaml: string
    ): Promise<{
        valid: boolean;
        errors: string[];
        warnings: string[];
        summary?: { title: string; level?: string; status?: string; tags: string[] };
    }> {
        return this.request('/api/v1/sigma/validate', {
            method: 'POST',
            body: JSON.stringify({ organizationId, yaml }),
        });
    }

    async updateRuleYaml(
        id: string,
        organizationId: string,
        yaml: string
    ): Promise<{ rule: SigmaRule }> {
        return this.request(`/api/v1/sigma/rules/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ organizationId, yaml }),
        });
    }

    async getMatches(
        id: string,
        organizationId: string,
        opts: { limit?: number; offset?: number; days?: number } = {}
    ): Promise<{ matches: DetectionEvent[]; total: number }> {
        const params = new URLSearchParams({ organizationId });
        if (opts.limit !== undefined) params.set('limit', String(opts.limit));
        if (opts.offset !== undefined) params.set('offset', String(opts.offset));
        if (opts.days !== undefined) params.set('days', String(opts.days));
        return this.request(`/api/v1/sigma/rules/${id}/matches?${params.toString()}`);
    }

    async previewRule(
        id: string,
        body: { organizationId: string; range: '24h' | '7d'; yaml?: string }
    ): Promise<SigmaRulePreviewResult> {
        return this.request(`/api/v1/sigma/rules/${id}/preview`, {
            method: 'POST',
            body: JSON.stringify(body),
        });
    }

    async listExceptions(
        id: string,
        organizationId: string
    ): Promise<{ exceptions: SigmaException[] }> {
        const params = new URLSearchParams({ organizationId });
        return this.request(`/api/v1/sigma/rules/${id}/exceptions?${params.toString()}`);
    }

    async createException(
        id: string,
        organizationId: string,
        body: CreateExceptionInput
    ): Promise<{ exception: SigmaException }> {
        return this.request(`/api/v1/sigma/rules/${id}/exceptions`, {
            method: 'POST',
            body: JSON.stringify({ organizationId, ...body }),
        });
    }

    async deleteException(
        id: string,
        exceptionId: string,
        organizationId: string
    ): Promise<{ success: boolean }> {
        const params = new URLSearchParams({ organizationId });
        return this.request(
            `/api/v1/sigma/rules/${id}/exceptions/${exceptionId}?${params.toString()}`,
            { method: 'DELETE' }
        );
    }

    // Phase 3: SigmaHQ Sync APIs

    async syncFromSigmaHQ(data: SyncSigmaParams): Promise<SyncResult> {
        return this.request('/api/v1/sigma/sync', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async getCategories(): Promise<{ categories: SigmaCategory[] }> {
        return this.request('/api/v1/sigma/categories');
    }

    async getCategoryTree(): Promise<{ tree: CategoryTreeNode[] }> {
        return this.request('/api/v1/sigma/tree');
    }

    async getRulesForCategory(
        categoryPath: string,
        includeMetadata: boolean = false
    ): Promise<{ rules: SigmaRuleMetadata[] }> {
        const queryParams = new URLSearchParams({
            includeMetadata: includeMetadata.toString(),
        });
        return this.request(
            `/api/v1/sigma/categories/${encodeURIComponent(categoryPath)}/rules?${queryParams.toString()}`
        );
    }

    async searchRules(
        query: string,
        category?: string
    ): Promise<{ results: SigmaRuleMetadata[] }> {
        const queryParams = new URLSearchParams({ q: query });
        if (category) {
            queryParams.set('category', category);
        }
        return this.request(`/api/v1/sigma/search?${queryParams.toString()}`);
    }

    async getSyncStatus(organizationId: string): Promise<SyncStatus> {
        const queryParams = new URLSearchParams({ organizationId });
        return this.request(`/api/v1/sigma/sync/status?${queryParams.toString()}`);
    }

    async searchByMITRETechnique(
        organizationId: string,
        technique: string
    ): Promise<{ rules: SigmaRule[] }> {
        const queryParams = new URLSearchParams({ organizationId });
        return this.request(
            `/api/v1/sigma/mitre/techniques/${technique}?${queryParams.toString()}`
        );
    }

    async searchByMITRETactic(
        organizationId: string,
        tactic: string
    ): Promise<{ rules: SigmaRule[] }> {
        const queryParams = new URLSearchParams({ organizationId });
        return this.request(
            `/api/v1/sigma/mitre/tactics/${tactic}?${queryParams.toString()}`
        );
    }

    async getMITRETactics(): Promise<{ tactics: MITRETactic[] }> {
        return this.request('/api/v1/sigma/mitre/tactics');
    }
}

export const sigmaAPI = new SigmaAPI(getAuthToken);
