// ============================================================================
// Reactive helpers that connect the picker loaders to a config form
// ============================================================================
//
// `createOptionsState` must be called during component initialisation (it
// registers an effect). Failures resolve to an empty list, so the form always
// stays usable with free typing.

import { get } from 'svelte/store';
import { organizationStore } from '$lib/stores/organization';
import {
  loadPickerOptions,
  loadMetadataKeys,
  loadMetricLabelKeys,
} from './picker-options';

export function currentOrganizationId(): string | null {
  return get(organizationStore).currentOrganization?.id ?? null;
}

export interface OptionsState {
  readonly list: string[];
  readonly loading: boolean;
}

/**
 * `load` runs inside an effect: whatever reactive state it reads (the
 * project id, the metric name) re-triggers it. Return null to skip loading.
 */
export function createOptionsState(load: () => Promise<string[]> | null): OptionsState {
  let list = $state<string[]>([]);
  let loading = $state(false);

  $effect(() => {
    const pending = load();
    if (!pending) {
      list = [];
      loading = false;
      return;
    }
    let cancelled = false;
    loading = true;
    pending.then((values) => {
      if (cancelled) return;
      list = values;
      loading = false;
    });
    return () => {
      cancelled = true;
    };
  });

  return {
    get list() {
      return list;
    },
    get loading() {
      return loading;
    },
  };
}

export function createServiceOptions(
  source: 'logs' | 'traces' | 'metrics',
  projectId: () => string | null
): OptionsState {
  return createOptionsState(() => {
    const organizationId = currentOrganizationId();
    const pid = projectId();
    if (!organizationId) return null;
    return loadPickerOptions({ organizationId, kind: 'services', source, projectId: pid });
  });
}

export function createMetricNameOptions(projectId: () => string | null): OptionsState {
  return createOptionsState(() => {
    const organizationId = currentOrganizationId();
    const pid = projectId();
    if (!organizationId) return null;
    return loadPickerOptions({ organizationId, kind: 'metric-names', projectId: pid });
  });
}

export function createMetadataKeyOptions(projectId: () => string | null): OptionsState {
  return createOptionsState(() => {
    const organizationId = currentOrganizationId();
    const pid = projectId();
    if (!organizationId) return null;
    return loadMetadataKeys({ organizationId, projectId: pid });
  });
}

export function createLabelKeyOptions(
  projectId: () => string | null,
  metricName: () => string
): OptionsState {
  return createOptionsState(() => {
    const pid = projectId();
    const metric = metricName().trim();
    if (!pid || !metric) return null;
    return loadMetricLabelKeys(pid, metric);
  });
}

/**
 * After the project changed: should the currently selected service be kept?
 * It is dropped only when the new project is known to offer a different set
 * of services; an unknown or empty answer keeps it.
 */
export async function keepServiceForProject(
  source: 'logs' | 'traces' | 'metrics',
  projectId: string | null,
  service: string | null | undefined
): Promise<boolean> {
  if (!service) return true;
  const organizationId = currentOrganizationId();
  if (!organizationId) return true;
  const offered = await loadPickerOptions({
    organizationId,
    kind: 'services',
    source,
    projectId,
  });
  return offered.length === 0 || offered.includes(service);
}
