<script lang="ts">
  import MetricCombobox from './MetricCombobox.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import {
    MAX_GROUP_BY,
    type MetricQueryState,
    type AggregationInterval,
  } from '$lib/utils/metrics-query';
  import type { MetricAggregationFn } from '$lib/api/metrics';
  import X from '@lucide/svelte/icons/x';
  import Plus from '@lucide/svelte/icons/plus';

  interface Props {
    metricNames: { name: string; type: string }[];
    metricNamesLoading?: boolean;
    query: MetricQueryState;
    labelKeys: string[];
    loadLabelValues: (key: string) => Promise<string[]>;
    services: string[];
    onChange: (patch: Partial<MetricQueryState>) => void;
    /** Only the service select, for tabs that have no metric query. */
    serviceOnly?: boolean;
  }

  let {
    metricNames,
    metricNamesLoading = false,
    query,
    labelKeys,
    loadLabelValues,
    services,
    onChange,
    serviceOnly = false,
  }: Props = $props();

  const AGGREGATIONS: { value: MetricAggregationFn; label: string; hint?: string }[] = [
    { value: 'avg', label: 'Average' },
    { value: 'sum', label: 'Sum' },
    { value: 'min', label: 'Min' },
    { value: 'max', label: 'Max' },
    { value: 'count', label: 'Count' },
    { value: 'last', label: 'Last' },
    { value: 'rate', label: 'Rate', hint: 'Per-second increase of a cumulative counter' },
    { value: 'p50', label: 'p50', hint: 'Computed over stored data point values' },
    { value: 'p95', label: 'p95', hint: 'Computed over stored data point values' },
    { value: 'p99', label: 'p99', hint: 'Computed over stored data point values' },
  ];

  const INTERVALS: { value: 'auto' | AggregationInterval; label: string }[] = [
    { value: 'auto', label: 'Auto' },
    { value: '1m', label: '1 minute' },
    { value: '5m', label: '5 minutes' },
    { value: '15m', label: '15 minutes' },
    { value: '1h', label: '1 hour' },
    { value: '6h', label: '6 hours' },
    { value: '1d', label: '1 day' },
    { value: '1w', label: '1 week' },
  ];

  const selectClass =
    'h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

  let aggHint = $derived(AGGREGATIONS.find((a) => a.value === query.aggregation)?.hint);

  // Group by picker
  let groupOpen = $state(false);
  let groupFull = $derived(query.groupBy.length >= MAX_GROUP_BY);

  function toggleGroup(key: string, checked: boolean) {
    const next = checked ? [...query.groupBy, key] : query.groupBy.filter((k) => k !== key);
    onChange({ groupBy: next.slice(0, MAX_GROUP_BY) });
  }

  // Filter builder
  let adding = $state(false);
  let draftKey = $state<string>('');
  let draftValues = $state<string[]>([]);
  let valueOptions = $state<string[]>([]);
  let valuesLoading = $state(false);

  async function pickKey(key: string) {
    draftKey = key;
    draftValues = [];
    valueOptions = [];
    if (!key) return;
    valuesLoading = true;
    try {
      valueOptions = await loadLabelValues(key);
    } finally {
      valuesLoading = false;
    }
  }

  function toggleDraftValue(value: string, checked: boolean) {
    draftValues = checked ? [...draftValues, value] : draftValues.filter((v) => v !== value);
  }

  function applyFilter() {
    if (!draftKey || draftValues.length === 0) return;
    const merged = [...new Set([...(query.where[draftKey] ?? []), ...draftValues])];
    onChange({ where: { ...query.where, [draftKey]: merged } });
    adding = false;
    draftKey = '';
    draftValues = [];
    valueOptions = [];
  }

  function removeFilter(key: string) {
    const next = { ...query.where };
    delete next[key];
    onChange({ where: next });
  }

  let multiValue = $derived(Object.values(query.where).some((v) => v.length > 1) || draftValues.length > 1);
</script>

<div class="space-y-3">
  <div class="flex flex-wrap items-end gap-3">
    {#if !serviceOnly}
    <div class="min-w-[240px] flex-1 space-y-1">
      <span class="text-xs font-medium text-muted-foreground">Metric</span>
      <MetricCombobox
        options={metricNames}
        value={query.metric}
        loading={metricNamesLoading}
        onSelect={(name) => onChange({ metric: name })}
      />
    </div>

    <div class="space-y-1">
      <label class="text-xs font-medium text-muted-foreground" for="metric-aggregation">Aggregate</label>
      <select
        id="metric-aggregation"
        class="{selectClass} block"
        value={query.aggregation}
        onchange={(e) => onChange({ aggregation: e.currentTarget.value as MetricAggregationFn })}
      >
        {#each AGGREGATIONS as agg (agg.value)}
          <option value={agg.value} title={agg.hint}>{agg.label}</option>
        {/each}
      </select>
    </div>

    <div class="relative space-y-1">
      <span class="text-xs font-medium text-muted-foreground">Group by</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="h-9 w-full justify-between gap-2 font-normal"
        aria-expanded={groupOpen}
        aria-haspopup="true"
        onclick={() => (groupOpen = !groupOpen)}
      >
        {query.groupBy.length > 0 ? query.groupBy.join(', ') : 'None'}
      </Button>
      {#if groupOpen}
        <div
          class="absolute z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
          role="group"
          aria-label="Group by labels"
        >
          {#each labelKeys as key (key)}
            {@const checked = query.groupBy.includes(key)}
            <label class="flex items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-muted">
              <input
                type="checkbox"
                {checked}
                disabled={!checked && groupFull}
                onchange={(e) => toggleGroup(key, e.currentTarget.checked)}
              />
              <span class="truncate">{key}</span>
            </label>
          {:else}
            <p class="px-2 py-1 text-sm text-muted-foreground">No labels available</p>
          {/each}
          <p class="mt-1 px-2 text-xs text-muted-foreground">
            Up to {MAX_GROUP_BY} labels. Charts show at most 20 series.
          </p>
        </div>
      {/if}
    </div>

    <div class="space-y-1">
      <label class="text-xs font-medium text-muted-foreground" for="metric-interval">Interval</label>
      <select
        id="metric-interval"
        class="{selectClass} block"
        value={query.interval}
        onchange={(e) => onChange({ interval: e.currentTarget.value as 'auto' | AggregationInterval })}
      >
        {#each INTERVALS as interval (interval.value)}
          <option value={interval.value}>{interval.label}</option>
        {/each}
      </select>
    </div>

    {/if}

    <div class="space-y-1">
      <label class="text-xs font-medium text-muted-foreground" for="metric-service">Service</label>
      <select
        id="metric-service"
        class="{selectClass} block max-w-[200px]"
        value={query.service ?? ''}
        onchange={(e) => onChange({ service: e.currentTarget.value || null })}
      >
        <option value="">All services</option>
        {#each services as service (service)}
          <option value={service}>{service}</option>
        {/each}
      </select>
    </div>
  </div>

  {#if !serviceOnly}
  {#if aggHint}
    <p class="text-xs text-muted-foreground">{aggHint}</p>
  {/if}

  <div class="flex flex-wrap items-center gap-2">
    <span class="text-xs font-medium text-muted-foreground">Where</span>
    {#each Object.entries(query.where) as [key, values] (key)}
      <Badge variant="secondary" class="flex items-center gap-1">
        <span class="font-medium">{key}</span>
        <span class="text-muted-foreground">=</span>
        <span>{values.join(', ')}</span>
        <button
          type="button"
          class="ml-1 rounded-sm hover:text-destructive-text"
          aria-label="Remove filter {key}"
          onclick={() => removeFilter(key)}
        >
          <X class="h-3 w-3" aria-hidden="true" />
        </button>
      </Badge>
    {/each}
    <Button
      type="button"
      variant="outline"
      size="sm"
      class="h-7 gap-1"
      disabled={!query.metric}
      onclick={() => (adding = !adding)}
    >
      <Plus class="h-3 w-3" aria-hidden="true" />
      Add filter
    </Button>
  </div>

  {#if adding}
    <div class="flex flex-wrap items-start gap-3 rounded-md border bg-card p-3">
      <div class="space-y-1">
        <label class="text-xs font-medium text-muted-foreground" for="metric-filter-key">Label</label>
        <select
          id="metric-filter-key"
          class="{selectClass} block"
          value={draftKey}
          onchange={(e) => pickKey(e.currentTarget.value)}
        >
          <option value="">Select label</option>
          {#each labelKeys as key (key)}
            <option value={key}>{key}</option>
          {/each}
        </select>
      </div>
      <div class="min-w-[200px] space-y-1">
        <span class="text-xs font-medium text-muted-foreground">Values</span>
        <div class="max-h-40 overflow-y-auto rounded-md border p-1" role="group" aria-label="Label values">
          {#if !draftKey}
            <p class="px-2 py-1 text-sm text-muted-foreground">Select a label first</p>
          {:else if valuesLoading}
            <p class="px-2 py-1 text-sm text-muted-foreground">Loading values</p>
          {:else}
            {#each valueOptions as value (value)}
              <label class="flex items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-muted">
                <input
                  type="checkbox"
                  checked={draftValues.includes(value)}
                  onchange={(e) => toggleDraftValue(value, e.currentTarget.checked)}
                />
                <span class="truncate">{value}</span>
              </label>
            {:else}
              <p class="px-2 py-1 text-sm text-muted-foreground">No values found</p>
            {/each}
          {/if}
        </div>
      </div>
      <div class="flex items-end gap-2 self-end">
        <Button type="button" size="sm" disabled={!draftKey || draftValues.length === 0} onclick={applyFilter}>
          Apply
        </Button>
        <Button type="button" size="sm" variant="ghost" onclick={() => (adding = false)}>Cancel</Button>
      </div>
    </div>
  {/if}

  {#if multiValue}
    <p class="text-xs text-muted-foreground">Each selected value is shown as its own series.</p>
  {/if}
  {/if}
</div>
