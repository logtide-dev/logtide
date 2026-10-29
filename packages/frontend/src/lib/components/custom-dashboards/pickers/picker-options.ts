// ============================================================================
// Option loaders for the dashboard panel form pickers
// ============================================================================
//
// Every loader NEVER rejects: it resolves [] on any error or after a 4 s
// timeout, so a form always stays usable with free typing.

import { customDashboardsAPI, type PickerOptionsParams } from '$lib/api/custom-dashboards';
import { metricsAPI } from '$lib/api/metrics';
import { getApiBaseUrl } from '$lib/config';
import { getAuthToken } from '$lib/utils/auth';

export const PICKER_TIMEOUT_MS = 4000;
export const PICKER_CACHE_TTL_MS = 60_000;

const cache = new Map<string, { at: number; values: string[] }>();

export function clearPickerCache(): void {
  cache.clear();
}

/** Resolves with the loader result, or [] when it fails or takes too long. */
async function safely(load: () => Promise<string[]>): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string[]>((resolve) => {
    timer = setTimeout(() => resolve([]), PICKER_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([load(), timeout]);
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function cached(key: string, load: () => Promise<string[]>): Promise<string[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < PICKER_CACHE_TTL_MS) return hit.values;

  let failed = false;
  const values = await safely(async () => {
    try {
      return await load();
    } catch (e) {
      failed = true;
      throw e;
    }
  });
  // Empty results from a failure or timeout are not cached, so the next
  // focus retries instead of staying empty for a minute.
  if (!failed && values.length > 0) cache.set(key, { at: Date.now(), values });
  return values;
}

export function loadPickerOptions(params: PickerOptionsParams): Promise<string[]> {
  const key = JSON.stringify([
    'options',
    params.organizationId,
    params.kind,
    params.source ?? null,
    params.projectId ?? null,
  ]);
  return cached(key, () => customDashboardsAPI.getOptions(params));
}

/**
 * Metadata key suggestions from `GET /api/v1/logs/fields` (response shape
 * `{ fields: { key: string; occurrences: number }[] }`). Free text when the
 * endpoint is missing or fails.
 */
export function loadMetadataKeys(params: {
  organizationId: string;
  projectId?: string | null;
}): Promise<string[]> {
  const key = JSON.stringify(['fields', params.organizationId, params.projectId ?? null]);
  return cached(key, async () => {
    const q = new URLSearchParams();
    if (params.projectId) q.set('projectId', params.projectId);
    const token = getAuthToken();
    const res = await fetch(`${getApiBaseUrl()}/logs/fields?${q.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    const body = (await res.json()) as { fields?: Array<{ key?: unknown }> };
    return (body.fields ?? [])
      .map((f) => f.key)
      .filter((k): k is string => typeof k === 'string' && k.length > 0);
  });
}

export function loadMetricLabelKeys(projectId: string, metricName: string): Promise<string[]> {
  const key = JSON.stringify(['label-keys', projectId, metricName]);
  return cached(key, () => metricsAPI.getLabelKeys(projectId, metricName));
}
