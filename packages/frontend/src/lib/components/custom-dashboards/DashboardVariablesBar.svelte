<!--
  One select per dashboard variable, shown above the panel grid.

  Props:
    variables       DashboardVariable[]
    values          current selection by name (null or missing = All)
    organizationId  scope of the option lookup
    projectId       dashboard project scope (null = every project)
    onChange        (name, value | null) => void
    api             lookup client, defaults to metricsV2API (injectable for tests)

  Options are the distinct values of the variable's attribute, plus "All".
  A value that came from the URL but is not offered is kept in the list.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { DashboardVariable } from '@logtide/shared';
  import { SelectField } from '$lib/components/ui/select';
  import { metricsV2API, type MetricsV2API } from '$lib/api/metrics-v2';

  type LookupApi = Pick<MetricsV2API, 'getAttributeValues'>;

  interface Props {
    variables: DashboardVariable[];
    values: Record<string, string | null>;
    organizationId: string;
    projectId?: string | null;
    onChange: (name: string, value: string | null) => void;
    api?: LookupApi;
  }

  let { variables, values, organizationId, projectId = null, onChange, api = metricsV2API }: Props = $props();

  let options = $state<Record<string, string[]>>({});
  let loading = $state<Record<string, boolean>>({});

  // Reload the options when the variable definitions or the scope change, not
  // when a selection changes.
  const loadKey = $derived(
    JSON.stringify([organizationId, projectId, variables.map((v) => [v.name, v.attr, v.metricName ?? null])])
  );

  $effect(() => {
    void loadKey;
    let cancelled = false;
    for (const v of variables) {
      untrack(() => (loading = { ...loading, [v.name]: true }));
      api
        .getAttributeValues({
          organizationId,
          projectIds: projectId ? [projectId] : null,
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
