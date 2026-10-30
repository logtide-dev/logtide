// ============================================================================
// Saved searches API client (logs explorer)
// ============================================================================

import { getApiUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';
import type {
  SavedSearch,
  SavedSearchState,
  SavedSearchVisibility,
} from '@logtide/shared';

export type { SavedSearch, SavedSearchState, SavedSearchVisibility };

export interface SavedSearchInput {
  name: string;
  visibility: SavedSearchVisibility;
  state: SavedSearchState;
}

class SavedSearchesAPI {
  constructor(private getToken: () => string | null) {}

  private headers(): Record<string, string> {
    const token = this.getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${getApiUrl()}/api/v1/saved-searches${path}`;
    const response = await fetch(url, { ...init, headers: this.headers() });
    if (!response.ok) {
      let message = `Request failed: ${response.status} ${response.statusText}`;
      try {
        const body = await response.json();
        if (body?.error) message = body.error;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async list(organizationId: string): Promise<SavedSearch[]> {
    const params = new URLSearchParams({ organizationId });
    const result = await this.request<{ savedSearches: SavedSearch[] }>(`?${params.toString()}`);
    return result.savedSearches;
  }

  async create(organizationId: string, input: SavedSearchInput): Promise<SavedSearch> {
    const result = await this.request<{ savedSearch: SavedSearch }>('', {
      method: 'POST',
      body: JSON.stringify({
        organizationId,
        name: input.name,
        visibility: input.visibility,
        state: input.state,
      }),
    });
    return result.savedSearch;
  }

  async update(
    id: string,
    organizationId: string,
    patch: Partial<SavedSearchInput>,
  ): Promise<SavedSearch> {
    const params = new URLSearchParams({ organizationId });
    const result = await this.request<{ savedSearch: SavedSearch }>(
      `/${encodeURIComponent(id)}?${params.toString()}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
    return result.savedSearch;
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const params = new URLSearchParams({ organizationId });
    await this.request<void>(`/${encodeURIComponent(id)}?${params.toString()}`, {
      method: 'DELETE',
    });
  }
}

export const savedSearchesAPI = new SavedSearchesAPI(getAuthToken);
