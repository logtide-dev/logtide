import { getApiUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';

export interface PipelineStep {
  type: 'parser' | 'grok' | 'geoip';
  parser?: 'nginx' | 'apache' | 'syslog' | 'logfmt' | 'odoo' | 'json';
  pattern?: string;
  source?: string;
  field?: string;
  target?: string;
}

export interface Pipeline {
  id: string;
  organizationId: string;
  projectId: string | null;
  name: string;
  description: string | null;
  enabled: boolean;
  steps: PipelineStep[];
  createdAt: string;
  updatedAt: string;
}

export interface PreviewResult {
  steps: Array<{ step: PipelineStep; extracted: Record<string, unknown>; error?: string }>;
  merged: Record<string, unknown>;
}

export interface CreatePipelineInput {
  name: string;
  description?: string;
  steps: PipelineStep[];
  enabled?: boolean;
  projectId?: string;
}

export interface UpdatePipelineInput {
  name?: string;
  description?: string;
  steps?: PipelineStep[];
  enabled?: boolean;
}

function extractErrorMessage(error: any, fallback: string): string {
  if (error.details?.length > 0) {
    const d = error.details[0];
    const field = d.path?.length ? `${d.path.join('.')}: ` : '';
    return `${field}${d.message}`;
  }
  return error.error || fallback;
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers: HeadersInit = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  return fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });
}

export const logPipelineAPI = {
  /**
   * List all pipelines for an organization
   */
  async list(organizationId: string, projectId?: string): Promise<Pipeline[]> {
    const params = new URLSearchParams({ organizationId });
    if (projectId) params.set('projectId', projectId);

    const response = await fetchWithAuth(`${getApiUrl()}/api/v1/log-pipelines?${params}`);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch pipelines' }));
      throw new Error(error.error || 'Failed to fetch pipelines');
    }

    const data = await response.json();
    return data.pipelines;
  },

  /**
   * Get a single pipeline
   */
  async get(id: string, organizationId: string): Promise<Pipeline> {
    const params = new URLSearchParams({ organizationId });
    const response = await fetchWithAuth(`${getApiUrl()}/api/v1/log-pipelines/${id}?${params}`);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch pipeline' }));
      throw new Error(error.error || 'Failed to fetch pipeline');
    }

    const data = await response.json();
    return data.pipeline;
  },

  /**
   * Create a new pipeline
   */
  async create(organizationId: string, input: CreatePipelineInput): Promise<Pipeline> {
    const params = new URLSearchParams({ organizationId });
    const response = await fetchWithAuth(`${getApiUrl()}/api/v1/log-pipelines?${params}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to create pipeline' }));
      throw new Error(extractErrorMessage(error, 'Failed to create pipeline'));
    }

    const data = await response.json();
    return data.pipeline;
  },

  /**
   * Update a pipeline
   */
  async update(
    id: string,
    organizationId: string,
    input: UpdatePipelineInput
  ): Promise<Pipeline> {
    const params = new URLSearchParams({ organizationId });
    const response = await fetchWithAuth(`${getApiUrl()}/api/v1/log-pipelines/${id}?${params}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to update pipeline' }));
      throw new Error(error.error || 'Failed to update pipeline');
    }

    const data = await response.json();
    return data.pipeline;
  },

  /**
   * Delete a pipeline
   */
  async delete(id: string, organizationId: string): Promise<void> {
    const params = new URLSearchParams({ organizationId });
    const response = await fetchWithAuth(`${getApiUrl()}/api/v1/log-pipelines/${id}?${params}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to delete pipeline' }));
      throw new Error(error.error || 'Failed to delete pipeline');
    }
  },

  /**
   * Preview pipeline execution on a sample log
   */
  async preview(
    organizationId: string,
    steps: PipelineStep[],
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<PreviewResult> {
    const params = new URLSearchParams({ organizationId });
    const response = await fetchWithAuth(`${getApiUrl()}/api/v1/log-pipelines/preview?${params}`, {
      method: 'POST',
      body: JSON.stringify({ steps, message, metadata }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to preview pipeline' }));
      throw new Error(extractErrorMessage(error, 'Failed to preview pipeline'));
    }

    const data = await response.json();
    return data.result;
  },

  /**
   * Import pipeline from YAML
   */
  async importYaml(organizationId: string, projectId: string | null, yaml: string): Promise<Pipeline> {
    const params = new URLSearchParams({ organizationId });
    if (projectId) params.set('projectId', projectId);

    const response = await fetchWithAuth(`${getApiUrl()}/api/v1/log-pipelines/import-yaml?${params}`, {
      method: 'POST',
      body: JSON.stringify({ yaml }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to import pipeline' }));
      throw new Error(extractErrorMessage(error, 'Failed to import pipeline'));
    }

    const data = await response.json();
    return data.pipeline;
  },
};
