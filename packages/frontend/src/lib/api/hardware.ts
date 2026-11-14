import { getApiUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';
import type {
  HardwareEventsResponse,
  HardwareHostDetailResponse,
  HardwareHostListResponse,
  HardwareHostSummary,
  HardwareHostUpdateInput,
} from '@logtide/shared';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const response = await fetch(`${getApiUrl()}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw Object.assign(new Error(error.error || `HTTP ${response.status}`), {
      status: response.status,
    });
  }

  if (response.status === 204) return null as T;
  return response.json();
}

export function listHardwareHosts(projectId: string): Promise<HardwareHostListResponse> {
  const params = new URLSearchParams({ projectId });
  return request(`/api/v1/hardware/hosts?${params}`);
}

export function getHardwareHost(id: string): Promise<HardwareHostDetailResponse> {
  return request(`/api/v1/hardware/hosts/${encodeURIComponent(id)}`);
}

export function getHardwareHostEvents(id: string, limit = 50): Promise<HardwareEventsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  return request(`/api/v1/hardware/hosts/${encodeURIComponent(id)}/events?${params}`);
}

export function updateHardwareHost(
  id: string,
  input: HardwareHostUpdateInput
): Promise<{ host: HardwareHostSummary }> {
  return request(`/api/v1/hardware/hosts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteHardwareHost(id: string): Promise<void> {
  return request(`/api/v1/hardware/hosts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
