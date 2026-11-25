<!--
  One select per dashboard variable, shown above the panel grid.

  Props:
    variables       DashboardVariable[]
    values          current selection by name (null or missing = All)
    organizationId  scope of the option lookup
    projectId       dashboard project scope (null = every project), used when
                    the dashboard has no metrics panels
    panels          dashboard panels; values are looked up across the union of
                    the metrics panels' projectIds (any null = every project)
    onChange        (name, value | null) => void
    api             lookup client, defaults to metricsV2API (injectable for tests)

  Options are the distinct values of the variable's attribute, plus "All".
  A value that came from the URL but is not offered is kept in the list.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { DashboardVariable, PanelInstance } from '@logtide/shared';
  import { SelectField } from '$lib/components/ui/select';
  import { metricsV2API, type MetricsV2API } from '$lib/api/metrics-v2';

  type LookupApi = Pick<MetricsV2API, 'getAttributeValues'>;

  interface Props {
    variables: DashboardVariable[];
    values: Record<string, string | null>;
    organizationId: string;
    projectId?: string | null;
    panels?: PanelInstance[];
    onChange: (name: string, value: string | null) => void;
    api?: LookupApi;
  }

  let { variables, values, organizationId, projectId = null, panels = [], onChange, api = metricsV2API }: Props = $props();

  let options = $state<Record<string, string[]>>({});
  let loading = $state<Record<string, boolean>>({});

  // Variables filter the metrics panels, so the selector must look up values
  // where those panels read: the union of their projectIds, null = all.
  const lookupProjectIds = $derived.by((): string[] | null => {
    const ids = new Set<string>();
    let hasMetrics = false;
    for (const p of panels) {
      if (p.config.type !== 'metrics') continue;
      hasMetrics = true;
      const pids = p.config.query.projectIds;
      if (pids === null || pids === undefined) return null;
      for (const id of pids) ids.add(id);
    }
    if (!hasMetrics) return projectId ? [projectId] : null;
    return [...ids].sort();
  });

  // Reload the options when the variable definitions or the scope change, not
  // when a selection changes.
  const loadKey = $derived(
    JSON.stringify([organizationId, lookupProjectIds, variables.map((v) => [v.name, v.attr, v.metricName ?? null])])
  );

  $effect(() => {
    void loadKey;
    let cancelled = false;
    for (const v of variables) {
      untrack(() => (loading = { ...loading, [v.name]: true }));
      api
        .getAttributeValues({
          organizationId,
          projectIds: lookupProjectIds,
          scope: v.attr.scope,
          key: v.attr.key,
          metricName: v.metricName ?? undefined,
        })
        .then((list) => {
          if (!cancelled) options = { ...options, [v.name]: list };
        })
        .catch(() => {
          if (!cancelled) options = { ...options, [v.name]: [] };
        })
        .finally(() => {
          if (!cancelled) loading = { ...loading, [v.name]: false };
        });
    }
    return () => {
      cancelled = true;
    };
  });

  function selectOptions(v: DashboardVariable) {
    const list = options[v.name] ?? [];
    const current = values[v.name] ?? null;
    const all = current !== null && !list.includes(current) ? [current, ...list] : list;
    return [{ value: '', label: 'All' }, ...all.map((x) => ({ value: x, label: x }))];
  }
</script>

{#if variables.length > 0}
  <div class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="dashboard-variables">
    {#each variables as v (v.name)}
      <div class="flex items-center gap-2">
        <span class="text-sm text-muted-foreground">{v.label || v.name}</span>
        <SelectField
          size="sm"
          class="w-48"
          aria-label={v.label || v.name}
          value={values[v.name] ?? ''}
          options={selectOptions(v)}
          onValueChange={(next) => onChange(v.name, next === '' ? null : next)}
        />
      </div>
    {/each}
  </div>
{/if}
