<script lang="ts">
  // Config form of the `metrics` panel: title, time range and the explorer
  // query (with the dashboard's variables offered as "$name" filter values).
  import type { MetricExplorerQuery, MetricsPanelConfig, PanelTimeRange } from '@logtide/shared';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import { SelectField } from '$lib/components/ui/select';
  import MetricQueryBuilder from '$lib/components/metrics/v2/MetricQueryBuilder.svelte';
  import { organizationStore } from '$lib/stores/organization';
  import ProjectMultiSelect from '../pickers/ProjectMultiSelect.svelte';
  import { dashboardVariables } from '$lib/stores/custom-dashboards';
  import { TIME_RANGE_OPTIONS } from '../time-range-options';

  interface Props {
    config: MetricsPanelConfig;
    onChange: (updated: MetricsPanelConfig) => void;
  }

  let { config, onChange }: Props = $props();

  const timeRangeOptions = TIME_RANGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));

  function setQuery(query: MetricExplorerQuery) {
    onChange({ ...config, query });
  }
</script>

<div class="space-y-4">
  <div class="space-y-1.5">
    <Label for="mp-title">Title</Label>
    <Input
      id="mp-title"
      type="text"
      value={config.title}
      oninput={(e) => onChange({ ...config, title: (e.currentTarget as HTMLInputElement).value })}
    />
  </div>

  <div class="space-y-1.5">
    <Label for="mp-project">Projects</Label>
    <ProjectMultiSelect
      id="mp-project"
      value={config.query.projectIds}
      onChange={(projectIds) => setQuery({ ...config.query, projectIds })}
    />
  </div>

  <div class="space-y-1.5">
    <Label for="mp-range">Time range</Label>
    <SelectField
      id="mp-range"
      value={config.timeRange}
      options={timeRangeOptions}
      onValueChange={(v) => onChange({ ...config, timeRange: v as PanelTimeRange })}
    />
  </div>

  {#if $organizationStore.currentOrganization}
    <MetricQueryBuilder
      value={config.query}
      onChange={setQuery}
      organizationId={$organizationStore.currentOrganization.id}
      variables={$dashboardVariables}
    />
  {:else}
    <p class="text-sm text-muted-foreground">Select an organization to edit the query.</p>
  {/if}
</div>
