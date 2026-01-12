import { getApiUrl } from '$lib/config';

export interface ImportSigmaRuleParams {
    yaml: string;
    organizationId: string;
    projectId?: string;
    emailRecipients?: string[];
    webhookUrl?: string;
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
                'Content-Type': 'application/json',
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

            throw new Error(errorMessage);
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

export const sigmaAPI = new SigmaAPI(() => {
    if (typeof window !== 'undefined') {
        try {
            const stored = localStorage.getItem('logtide_auth');
            if (stored) {
                const data = JSON.parse(stored);
                return data.token;
            }
        } catch (e) {
            console.error('Failed to get token:', e);
        }
    }
    return null;
});
