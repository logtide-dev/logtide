<!--
  One query row of the MetricQueryBuilder (internal; use MetricQueryBuilder).

  Props:
    spec          the MetricQuerySpec being edited
    catalog       catalog entries for the metric picker
    variables     dashboard variables selectable as "$name" filter values
    loadKeys      (metricName, scope) => Promise<string[]>
    loadValues    (metricName, scope, key) => Promise<string[]>
    canRemove     show the remove button
    onChange      called with the new spec
    onRemove      called when the row is removed
-->
<script lang="ts">
  import {
    METRIC_ATTR_FILTER_OPS,
    METRIC_MAX_FILTERS,
    METRIC_MAX_GROUP_BY,
    METRIC_MAX_SERIES_LIMIT,
    METRIC_SPACE_AGGREGATIONS,
    METRIC_TIME_AGGREGATIONS,
    defaultSpaceAggregation,
    metricUnitLabel,
    type DashboardVariable,
    type MetricAttrFilter,
    type MetricAttrFilterOp,
    type MetricAttrRef,
    type MetricAttrScope,
    type MetricCatalogEntry,
    type MetricQuerySpec,
    type MetricSpaceAggregation,
    type MetricTimeAggregation,
  } from '@logtide/shared';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Input } from '$lib/components/ui/input';
  import { SelectField } from '$lib/components/ui/select';
  import X from '@lucide/svelte/icons/x';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Plus from '@lucide/svelte/icons/plus';
  import AutocompleteInput, { type AutocompleteOption } from './AutocompleteInput.svelte';

  interface Props {
    spec: MetricQuerySpec;
    catalog: MetricCatalogEntry[];
    variables?: DashboardVariable[];
    loadKeys: (metricName: string, scope: MetricAttrScope) => Promise<string[]>;
    loadValues: (metricName: string, scope: MetricAttrScope, key: string) => Promise<string[]>;
    canRemove?: boolean;
    onChange: (spec: MetricQuerySpec) => void;
    onRemove: () => void;
  }

  let { spec, catalog, variables = [], loadKeys, loadValues, canRemove = true, onChange, onRemove }: Props = $props();

  const OP_LABELS: Record<MetricAttrFilterOp, string> = {
    eq: 'is',
    neq: 'is not',
    in: 'is one of',
    nin: 'is not one of',
    exists: 'exists',
    notExists: 'does not exist',
    gte: '>=',
    lt: '<',
  };
  const NO_VALUE_OPS: MetricAttrFilterOp[] = ['exists', 'notExists'];
  const MULTI_OPS: MetricAttrFilterOp[] = ['in', 'nin'];

  const scopeOptions = [
    { value: 'metric', label: 'Metric' },
    { value: 'resource', label: 'Resource' },
  ];
  const opOptions = METRIC_ATTR_FILTER_OPS.map((o) => ({ value: o, label: OP_LABELS[o] }));
  const aggOptions = METRIC_TIME_AGGREGATIONS.map((a) => ({ value: a, label: a }));
  const spaceOptions = $derived([
    { value: '', label: `Default (${defaultSpaceAggregation(spec.aggregation)})` },
    ...METRIC_SPACE_AGGREGATIONS.map((a) => ({ value: a, label: a })),
  ]);

  const entry = $derived(catalog.find((c) => c.name === spec.metricName));
  const metricOptions = $derived<AutocompleteOption[]>(
    catalog.map((c) => ({
      value: c.name,
      hint: [c.type, c.unit ? (metricUnitLabel(c.unit, c.name) ?? c.unit) : null].filter(Boolean).join(' · '),
    })),
  );

  function patch(p: Partial<MetricQuerySpec>) {
    onChange({ ...spec, ...p });
  }

  // ---- filters ----
  let filterOpen = $state(false);
  let fScope = $state<MetricAttrScope>('metric');
  let fKey = $state('');
  let fOp = $state<MetricAttrFilterOp>('eq');
  let fValues = $state<string[]>([]);
  let keyOptions = $state<AutocompleteOption[]>([]);
  let valueOptions = $state<AutocompleteOption[]>([]);
  let keysLoading = $state(false);
  let valuesLoading = $state(false);
  let loadError = $state<string | null>(null);

  const needsValues = $derived(!NO_VALUE_OPS.includes(fOp));
  const multi = $derived(MULTI_OPS.includes(fOp));

  async function fetchKeys(scope: MetricAttrScope) {
    keysLoading = true;
    loadError = null;
    try {
      keyOptions = (await loadKeys(spec.metricName, scope)).map((k) => ({ value: k }));
    } catch (e) {
      keyOptions = [];
      loadError = e instanceof Error ? e.message : 'Could not load attribute keys';
    } finally {
      keysLoading = false;
    }
  }

  async function fetchValues(scope: MetricAttrScope, key: string) {
    const vars = variables.map((v) => ({ value: `$${v.name}`, hint: 'variable' }));
    valueOptions = vars;
    if (!key) return;
    valuesLoading = true;
    try {
      const vals = await loadValues(spec.metricName, scope, key);
      valueOptions = [...vars, ...vals.map((v) => ({ value: v }))];
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Could not load values';
    } finally {
      valuesLoading = false;
    }
  }

  function startFilter() {
    filterOpen = true;
    fKey = '';
    fOp = 'eq';
    fValues = [];
    void fetchKeys(fScope);
  }

  function setFilterScope(scope: string) {
    fScope = scope as MetricAttrScope;
    fKey = '';
    fValues = [];
    void fetchKeys(fScope);
  }

  function addFilterValue(v: string) {
    fValues = multi ? (fValues.includes(v) ? fValues : [...fValues, v]) : [v];
  }

  const canAddFilter = $derived(fKey !== '' && (!needsValues || fValues.length > 0));

  function commitFilter() {
    if (!canAddFilter || spec.filters.length >= METRIC_MAX_FILTERS) return;
    const f: MetricAttrFilter = { scope: fScope, key: fKey, op: fOp };
    if (needsValues) f.values = [...fValues];
    patch({ filters: [...spec.filters, f] });
    filterOpen = false;
  }

  function removeFilter(i: number) {
    patch({ filters: spec.filters.filter((_, idx) => idx !== i) });
  }

  function filterText(f: MetricAttrFilter): string {
    const key = f.scope === 'resource' ? `resource.${f.key}` : f.key;
    const vals = f.values && f.values.length > 0 ? ` ${f.values.join(', ')}` : '';
    return `${key} ${OP_LABELS[f.op]}${vals}`;
  }

  // ---- group by ----
  let groupOpen = $state(false);
  let gScope = $state<MetricAttrScope>('resource');
  let groupKeyOptions = $state<AutocompleteOption[]>([]);

  async function fetchGroupKeys(scope: MetricAttrScope) {
    try {
      groupKeyOptions = (await loadKeys(spec.metricName, scope)).map((k) => ({ value: k }));
    } catch {
      groupKeyOptions = [];
    }
  }

  function startGroup() {
    groupOpen = true;
    void fetchGroupKeys(gScope);
  }

  function setGroupScope(scope: string) {
    gScope = scope as MetricAttrScope;
    void fetchGroupKeys(gScope);
  }

  function addGroup(key: string) {
    const ref: MetricAttrRef = { scope: gScope, key };
    if (spec.groupBy.some((g) => g.scope === ref.scope && g.key === ref.key)) return;
    if (spec.groupBy.length >= METRIC_MAX_GROUP_BY) return;
    patch({ groupBy: [...spec.groupBy, ref] });
    groupOpen = false;
  }

  function removeGroup(i: number) {
    const next = spec.groupBy.filter((_, idx) => idx !== i);
    patch({ groupBy: next, ...(next.length === 0 ? { limit: undefined } : {}) });
  }

  function groupText(g: MetricAttrRef): string {
    return g.scope === 'resource' ? `resource.${g.key}` : g.key;
  }

  function setLimit(raw: string) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return patch({ limit: undefined });
    patch({ limit: Math.min(METRIC_MAX_SERIES_LIMIT, Math.max(1, n)) });
  }
</script>

<section class="space-y-3 rounded-lg border border-border bg-card p-3 {spec.hidden ? 'opacity-60' : ''}" aria-label="Query {spec.id}">
  <div class="flex flex-wrap items-center gap-2">
    <Badge variant="secondary" class="shrink-0 font-mono">{spec.id}</Badge>
    <div class="min-w-[240px] flex-1">
      <AutocompleteInput
        value={spec.metricName}
        options={metricOptions}
        ariaLabel="Metric {spec.id}"
        placeholder="Select a metric"
        onCommit={(v) => patch({ metricName: v })}
      />
    </div>
    {#if entry}
      <Badge variant="outline" class="shrink-0 text-xs">{entry.type}</Badge>
      {#if entry.unit}<Badge variant="outline" class="shrink-0 text-xs">{metricUnitLabel(entry.unit, entry.name) ?? entry.unit}</Badge>{/if}
    {/if}
    <Input
      class="h-8 w-36"
      placeholder="Label"
      aria-label="Label {spec.id}"
      value={spec.label ?? ''}
      oninput={(e) => patch({ label: e.currentTarget.value || undefined })}
    />
    <Button
      variant="ghost"
      size="icon"
      class="h-8 w-8"
      aria-label={spec.hidden ? `Show query ${spec.id}` : `Hide query ${spec.id}`}
      aria-pressed={!!spec.hidden}
      onclick={() => patch({ hidden: spec.hidden ? undefined : true })}
    >
      {#if spec.hidden}<EyeOff class="h-4 w-4" aria-hidden="true" />{:else}<Eye class="h-4 w-4" aria-hidden="true" />{/if}
    </Button>
    {#if canRemove}
      <Button variant="ghost" size="icon" class="h-8 w-8" aria-label="Remove query {spec.id}" onclick={onRemove}>
        <Trash2 class="h-4 w-4" aria-hidden="true" />
      </Button>
    {/if}
  </div>

  <div class="flex flex-wrap items-center gap-2 text-sm">
    <span class="text-muted-foreground">Aggregate</span>
    <SelectField
      size="sm"
      class="w-24"
      aria-label="Time aggregation {spec.id}"
      value={spec.aggregation}
      options={aggOptions}
      onValueChange={(v) => patch({ aggregation: v as MetricTimeAggregation })}
    />
    <span class="text-muted-foreground">across series with</span>
    <SelectField
      size="sm"
      class="w-36"
      aria-label="Space aggregation {spec.id}"
      value={spec.spaceAggregation ?? ''}
      options={spaceOptions}
      onValueChange={(v) => patch({ spaceAggregation: v === '' ? undefined : (v as MetricSpaceAggregation) })}
    />
  </div>

  <div class="flex flex-wrap items-center gap-2 text-sm">
    <span class="text-muted-foreground">Filters</span>
    {#each spec.filters as f, i (i)}
      <Badge variant="secondary" class="gap-1 pr-1 font-normal">
        <span>{filterText(f)}</span>
        <button
          type="button"
          class="rounded-full p-0.5 hover:bg-background"
          aria-label="Remove filter {filterText(f)}"
          onclick={() => removeFilter(i)}
        >
          <X class="h-3 w-3" aria-hidden="true" />
        </button>
      </Badge>
    {/each}
    {#if !filterOpen && spec.filters.length < METRIC_MAX_FILTERS}
      <Button variant="outline" size="sm" class="h-7" onclick={startFilter}>
        <Plus class="mr-1 h-3 w-3" aria-hidden="true" />Add filter
      </Button>
    {/if}
  </div>

  {#if filterOpen}
    <div class="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-2" role="group" aria-label="New filter {spec.id}">
      <SelectField size="sm" class="w-28" aria-label="Filter scope {spec.id}" value={fScope} options={scopeOptions} onValueChange={setFilterScope} />
      <AutocompleteInput
        value={fKey}
        options={keyOptions}
        loading={keysLoading}
        ariaLabel="Filter key {spec.id}"
        placeholder="Attribute key"
        onOpen={() => fetchKeys(fScope)}
        onCommit={(k) => {
          fKey = k;
          fValues = [];
          void fetchValues(fScope, k);
        }}
      />
      <SelectField
        size="sm"
        class="w-36"
        aria-label="Filter operator {spec.id}"
        value={fOp}
        options={opOptions}
        onValueChange={(v) => {
          fOp = v as MetricAttrFilterOp;
          fValues = [];
        }}
      />
      {#if needsValues}
        {#each fValues as v (v)}
          <Badge variant="outline" class="gap-1 pr-1 font-normal">
            {v}
            <button type="button" class="rounded-full p-0.5 hover:bg-muted" aria-label="Remove value {v}" onclick={() => (fValues = fValues.filter((x) => x !== v))}>
              <X class="h-3 w-3" aria-hidden="true" />
            </button>
          </Badge>
        {/each}
        <AutocompleteInput
          value={multi ? '' : (fValues[0] ?? '')}
          options={valueOptions}
          loading={valuesLoading}
          ariaLabel="Filter value {spec.id}"
          placeholder={variables.length > 0 ? 'Value or $variable' : 'Value'}
          onOpen={() => fetchValues(fScope, fKey)}
          onCommit={addFilterValue}
        />
      {/if}
      <Button size="sm" class="h-7" disabled={!canAddFilter} onclick={commitFilter}>Add</Button>
      <Button variant="ghost" size="sm" class="h-7" onclick={() => (filterOpen = false)}>Cancel</Button>
      {#if loadError}<span class="text-xs text-muted-foreground" role="status">{loadError}</span>{/if}
    </div>
  {/if}

  <div class="flex flex-wrap items-center gap-2 text-sm">
    <span class="text-muted-foreground">Group by</span>
    {#each spec.groupBy as g, i (groupText(g))}
      <Badge variant="secondary" class="gap-1 pr-1 font-normal">
        <span>{groupText(g)}</span>
        <button
          type="button"
          class="rounded-full p-0.5 hover:bg-background"
          aria-label="Remove group by {groupText(g)}"
          onclick={() => removeGroup(i)}
        >
          <X class="h-3 w-3" aria-hidden="true" />
        </button>
      </Badge>
    {/each}
    {#if groupOpen}
      <SelectField size="sm" class="w-28" aria-label="Group by scope {spec.id}" value={gScope} options={scopeOptions} onValueChange={setGroupScope} />
      <AutocompleteInput
        value=""
        options={groupKeyOptions}
        ariaLabel="Group by key {spec.id}"
        placeholder="Attribute key"
        onOpen={() => fetchGroupKeys(gScope)}
        onCommit={addGroup}
      />
      <Button variant="ghost" size="sm" class="h-7" onclick={() => (groupOpen = false)}>Cancel</Button>
    {:else if spec.groupBy.length < METRIC_MAX_GROUP_BY}
      <Button variant="outline" size="sm" class="h-7" onclick={startGroup}>
        <Plus class="mr-1 h-3 w-3" aria-hidden="true" />Add group by
      </Button>
    {/if}
    {#if spec.groupBy.length > 0}
      <span class="ml-2 text-muted-foreground">Top</span>
      <Input
        type="number"
        class="h-8 w-20"
        min={1}
        max={METRIC_MAX_SERIES_LIMIT}
        aria-label="Top N {spec.id}"
        placeholder="10"
        value={spec.limit ?? ''}
        onchange={(e) => setLimit(e.currentTarget.value)}
      />
    {/if}
  </div>
</section>
