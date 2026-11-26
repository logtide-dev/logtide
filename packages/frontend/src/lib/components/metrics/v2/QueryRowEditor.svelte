<!--
  One query row of the MetricQueryBuilder (internal; use MetricQueryBuilder).

  One line: letter, metric (type and unit), aggregation, group by, top N and
  the row actions. Filters show as chips under it when there are any; adding a
  filter or a group by opens a small editor below the line. Label, how series
  are combined and delete live in the row menu.

  Props:
    spec          the MetricQuerySpec being edited
    catalog       catalog entries for the metric picker
    projectNames  project id -> name, to say where a metric comes from (optional)
    variables     dashboard variables selectable as "$name" filter values
    loadKeys      (metricName, scope) => Promise<string[]>
    loadValues    (metricName, scope, key) => Promise<string[]>
    canRemove     offer "Remove query"
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
  import { Input } from '$lib/components/ui/input';
  import { SelectField } from '$lib/components/ui/select';
  import * as Popover from '$lib/components/ui/popover';
  import X from '@lucide/svelte/icons/x';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Plus from '@lucide/svelte/icons/plus';
  import Filter from '@lucide/svelte/icons/filter';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Server from '@lucide/svelte/icons/server';
  import Box from '@lucide/svelte/icons/box';
  import Layers from '@lucide/svelte/icons/layers';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import AutocompleteInput, { type AutocompleteOption } from './AutocompleteInput.svelte';

  interface Props {
    spec: MetricQuerySpec;
    catalog: MetricCatalogEntry[];
    projectNames?: Record<string, string>;
    variables?: DashboardVariable[];
    loadKeys: (metricName: string, scope: MetricAttrScope) => Promise<string[]>;
    loadValues: (metricName: string, scope: MetricAttrScope, key: string) => Promise<string[]>;
    canRemove?: boolean;
    onChange: (spec: MetricQuerySpec) => void;
    onRemove: () => void;
  }

  let { spec, catalog, projectNames = {}, variables = [], loadKeys, loadValues, canRemove = true, onChange, onRemove }: Props = $props();

  const OP_LABELS: Record<MetricAttrFilterOp, string> = {
    eq: '=',
    neq: '!=',
    in: 'in',
    nin: 'not in',
    exists: 'exists',
    notExists: 'does not exist',
    gte: '>=',
    lt: '<',
  };
  const OP_OPTION_LABELS: Record<MetricAttrFilterOp, string> = {
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
    { value: 'resource', label: 'Source' },
    { value: 'metric', label: 'Data point' },
  ];
  const opOptions = METRIC_ATTR_FILTER_OPS.map((o) => ({ value: o, label: OP_OPTION_LABELS[o] }));
  const aggOptions = METRIC_TIME_AGGREGATIONS.map((a) => ({ value: a, label: a }));
  const spaceOptions = $derived([
    { value: '', label: `Default (${defaultSpaceAggregation(spec.aggregation)})` },
    ...METRIC_SPACE_AGGREGATIONS.map((a) => ({ value: a, label: a })),
  ]);

  // A name sent with several kinds (a gauge here, a counter there) is offered once
  // per kind and the query keeps the kind, so the two are never mixed.
  const KIND_SEP = '|kind:';
  const nameCounts = $derived(
    catalog.reduce((m, c) => m.set(c.name, (m.get(c.name) ?? 0) + 1), new Map<string, number>()),
  );
  const entry = $derived(
    catalog.find((c) => c.name === spec.metricName && (!spec.metricType || c.type === spec.metricType)),
  );
  const unit = $derived(entry?.unit ? (metricUnitLabel(entry.unit, entry.name) ?? entry.unit) : null);
  function projectsText(ids: string[]): string | null {
    const names = ids.map((id) => projectNames[id]).filter(Boolean);
    if (names.length === 0 || Object.keys(projectNames).length < 2) return null;
    return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  }
  const metricOptions = $derived<AutocompleteOption[]>(
    catalog.map((c) => ({
      value: (nameCounts.get(c.name) ?? 0) > 1 ? `${c.name}${KIND_SEP}${c.type}` : c.name,
      label: c.name,
      hint: [c.type, c.unit ? (metricUnitLabel(c.unit, c.name) ?? c.unit) : null, projectsText(c.projectIds)]
        .filter(Boolean)
        .join(' · '),
    })),
  );
  function pickMetric(v: string) {
    const [name, kind] = v.split(KIND_SEP);
    const next: Partial<MetricQuerySpec> = { metricName: name, metricType: (kind as MetricQuerySpec['metricType']) || undefined };
    // a new metric starts from every source
    if (name !== spec.metricName) next.filters = spec.filters.filter((_, i) => i !== sourceFilterIndex);
    patch(next);
  }
  const kindAmbiguous = $derived((nameCounts.get(spec.metricName) ?? 0) > 1);

  // ---- "from": the source the query reads (a host.name or service.name filter) ----
  const SOURCE_KEYS = ['host.name', 'service.name'] as const;
  type SourceKey = (typeof SOURCE_KEYS)[number];
  const sourceFilterIndex = $derived(
    spec.filters.findIndex(
      (f) => f.scope === 'resource' && (SOURCE_KEYS as readonly string[]).includes(f.key) && f.op === 'eq' && f.values?.length === 1,
    ),
  );
  const sourceFilter = $derived(sourceFilterIndex >= 0 ? spec.filters[sourceFilterIndex] : null);
  let fromOpen = $state(false);
  let fromHosts = $state<string[]>([]);
  let fromServices = $state<string[]>([]);
  let fromLoading = $state(false);
  let fromQuery = $state('');

  async function loadFrom() {
    if (!spec.metricName) return;
    fromLoading = true;
    try {
      const [h, sv] = await Promise.all([
        loadValues(spec.metricName, 'resource', 'host.name').catch(() => [] as string[]),
        loadValues(spec.metricName, 'resource', 'service.name').catch(() => [] as string[]),
      ]);
      fromHosts = [...h].sort();
      fromServices = [...sv].sort();
    } finally {
      fromLoading = false;
    }
  }

  function setSource(key: SourceKey | null, value?: string) {
    const rest = spec.filters.filter((_, i) => i !== sourceFilterIndex);
    patch({ filters: key && value ? [{ scope: 'resource', key, op: 'eq', values: [value] }, ...rest] : rest });
    fromOpen = false;
  }
  const fromMatch = (v: string) => v.toLowerCase().includes(fromQuery.trim().toLowerCase());
  const fromGroups = $derived([
    { key: 'host.name' as SourceKey, label: 'Hosts', icon: Server, values: fromHosts.filter(fromMatch) },
    { key: 'service.name' as SourceKey, label: 'Services', icon: Box, values: fromServices.filter(fromMatch) },
  ]);

  function patch(p: Partial<MetricQuerySpec>) {
    onChange({ ...spec, ...p });
  }

  /** Source (resource) attributes read as plain keys; data point attributes too, the scope is in the tooltip. */
  const attrText = (scope: MetricAttrScope, key: string) => key;
  const scopeHint = (scope: MetricAttrScope) => (scope === 'resource' ? 'Source attribute' : 'Data point attribute');

  // ---- editors under the line ----
  let editor = $state<'filter' | 'group' | null>(null);

  // ---- filters ----
  let fScope = $state<MetricAttrScope>('resource');
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
    editor = 'filter';
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
    editor = null;
  }

  function removeFilter(i: number) {
    patch({ filters: spec.filters.filter((_, idx) => idx !== i) });
  }

  function filterText(f: MetricAttrFilter): string {
    const vals = f.values && f.values.length > 0 ? ` ${f.values.join(', ')}` : '';
    return `${attrText(f.scope, f.key)} ${OP_LABELS[f.op]}${vals}`;
  }

  // ---- group by ----
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
    editor = 'group';
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
    editor = null;
  }

  function removeGroup(i: number) {
    const next = spec.groupBy.filter((_, idx) => idx !== i);
    patch({ groupBy: next, ...(next.length === 0 ? { limit: undefined } : {}) });
  }

  function setLimit(raw: string) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return patch({ limit: undefined });
    patch({ limit: Math.min(METRIC_MAX_SERIES_LIMIT, Math.max(1, n)) });
  }

  let moreOpen = $state(false);

  const chip =
    'inline-flex h-7 items-center gap-1 rounded-md border border-border bg-muted/40 pl-2 pr-1 text-xs text-foreground';
  const chipX = 'rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground';
  const ghostAdd =
    'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';
</script>

<section class="px-3 py-2.5 {spec.hidden ? 'opacity-60' : ''}" aria-label="Query {spec.id}" data-testid="query-row-{spec.id}">
  <div class="flex flex-wrap items-center gap-2">
    <span
      class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 font-mono text-xs font-semibold text-primary"
      aria-hidden="true">{spec.id}</span
    >
    <div class="min-w-[220px] flex-1">
      <AutocompleteInput
        value={spec.metricName}
        options={metricOptions}
        ariaLabel="Metric {spec.id}"
        placeholder="Select a metric"
        onCommit={pickMetric}
      />
    </div>
    {#if entry}
      <span
        class="shrink-0 text-xs {kindAmbiguous ? 'text-warning-text' : 'text-muted-foreground'}"
        title={kindAmbiguous ? `This name is also sent as another kind; only ${entry.type} points are read` : undefined}
        data-testid="metric-kind-{spec.id}">{entry.type}{unit ? ` · ${unit}` : ''}</span
      >
    {/if}

    {#if spec.metricName}
      <span class="text-xs text-muted-foreground">from</span>
      <Popover.Root
        bind:open={fromOpen}
        onOpenChange={(o) => {
          if (o) {
            fromQuery = '';
            void loadFrom();
          }
        }}
      >
        <Popover.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              class="inline-flex h-8 max-w-56 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Source of query {spec.id}"
              data-testid="query-source-{spec.id}"
            >
              {#if sourceFilter}
                {#if sourceFilter.key === 'host.name'}
                  <Server class="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                {:else}
                  <Box class="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                {/if}
                <span class="truncate">{sourceFilter.values?.[0]}</span>
              {:else}
                <Layers class="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>all sources</span>
              {/if}
              <ChevronDown class="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-64 p-2" align="start">
          <Input class="mb-2 h-8 text-xs" placeholder="Search sources" aria-label="Search sources of query {spec.id}" bind:value={fromQuery} />
          <div class="max-h-72 space-y-0.5 overflow-y-auto">
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted {sourceFilter ? '' : 'bg-muted font-medium'}"
              onclick={() => setSource(null)}
            >
              <Layers class="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />All sources
            </button>
            {#if fromLoading && fromHosts.length === 0 && fromServices.length === 0}
              <p class="px-2 py-2 text-xs text-muted-foreground" role="status">Loading sources</p>
            {/if}
            {#each fromGroups as group (group.key)}
              {#if group.values.length > 0}
                <p class="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
                {#each group.values as v (v)}
                  {@const on = sourceFilter?.key === group.key && sourceFilter.values?.[0] === v}
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted {on ? 'bg-muted font-medium' : ''}"
                    onclick={() => setSource(group.key, v)}
                  >
                    <group.icon class="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span class="truncate">{v}</span>
                  </button>
                {/each}
              {/if}
            {/each}
            {#if !fromLoading && fromHosts.length === 0 && fromServices.length === 0}
              <p class="px-2 py-2 text-xs text-muted-foreground">No host.name or service.name on this metric.</p>
            {/if}
          </div>
        </Popover.Content>
      </Popover.Root>
    {/if}

    <SelectField
      size="sm"
      class="w-24"
      aria-label="Time aggregation {spec.id}"
      value={spec.aggregation}
      options={aggOptions}
      onValueChange={(v) => patch({ aggregation: v as MetricTimeAggregation })}
    />

    <span class="text-xs text-muted-foreground">by</span>
    {#each spec.groupBy as g, i (`${g.scope}:${g.key}`)}
      <span class={chip} title={scopeHint(g.scope)}>
        {attrText(g.scope, g.key)}
        <button type="button" class={chipX} aria-label="Remove group by {g.key}" onclick={() => removeGroup(i)}>
          <X class="h-3 w-3" aria-hidden="true" />
        </button>
      </span>
    {:else}
      <span class="text-xs text-muted-foreground">all series</span>
    {/each}
    {#if spec.groupBy.length < METRIC_MAX_GROUP_BY}
      <button type="button" class={ghostAdd} onclick={startGroup} aria-label="Add group by">
        <Plus class="h-3 w-3" aria-hidden="true" />group
      </button>
    {/if}
    {#if spec.groupBy.length > 0}
      <label class="flex items-center gap-1 text-xs text-muted-foreground">
        top
        <Input
          type="number"
          class="h-7 w-16 px-2 text-xs"
          min={1}
          max={METRIC_MAX_SERIES_LIMIT}
          aria-label="Top N {spec.id}"
          placeholder="10"
          value={spec.limit ?? ''}
          onchange={(e) => setLimit(e.currentTarget.value)}
        />
      </label>
    {/if}

    <div class="ml-auto flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8"
        aria-label="Add filter"
        title="Add filter"
        disabled={spec.filters.length >= METRIC_MAX_FILTERS}
        onclick={startFilter}
      >
        <Filter class="h-4 w-4" aria-hidden="true" />
      </Button>
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
      <Popover.Root bind:open={moreOpen}>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="ghost" size="icon" class="h-8 w-8" aria-label="More options for query {spec.id}">
              <Ellipsis class="h-4 w-4" aria-hidden="true" />
            </Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-72 space-y-3 p-3" align="end">
          <label class="block space-y-1 text-xs text-muted-foreground">
            Label
            <Input
              class="h-8"
              placeholder="Shown in the legend"
              aria-label="Label {spec.id}"
              value={spec.label ?? ''}
              oninput={(e) => patch({ label: e.currentTarget.value || undefined })}
            />
          </label>
          <div class="space-y-1 text-xs text-muted-foreground">
            <span>Combine series with</span>
            <SelectField
              size="sm"
              class="w-full"
              aria-label="Space aggregation {spec.id}"
              value={spec.spaceAggregation ?? ''}
              options={spaceOptions}
              onValueChange={(v) => patch({ spaceAggregation: v === '' ? undefined : (v as MetricSpaceAggregation) })}
            />
            <p>How series of the same group are merged, for example several disks of one host.</p>
          </div>
          {#if canRemove}
            <Button
              variant="ghost"
              size="sm"
              class="w-full justify-start text-destructive-text hover:text-destructive-text"
              aria-label="Remove query {spec.id}"
              onclick={() => {
                moreOpen = false;
                onRemove();
              }}
            >
              <Trash2 class="mr-2 h-4 w-4" aria-hidden="true" />Remove query
            </Button>
          {/if}
        </Popover.Content>
      </Popover.Root>
    </div>
  </div>

  {#if spec.filters.some((_, i) => i !== sourceFilterIndex)}
    <div class="mt-2 flex flex-wrap items-center gap-1.5 pl-8">
      <span class="text-xs text-muted-foreground">where</span>
      {#each spec.filters as f, i (i)}
        {#if i !== sourceFilterIndex}
        <span class={chip} title={scopeHint(f.scope)}>
          {filterText(f)}
          <button type="button" class={chipX} aria-label="Remove filter {filterText(f)}" onclick={() => removeFilter(i)}>
            <X class="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
        {/if}
      {/each}
    </div>
  {/if}

  {#if editor === 'filter'}
    <div class="mt-2 ml-8 flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-2" role="group" aria-label="New filter {spec.id}">
      <SelectField size="sm" class="w-32" aria-label="Filter scope {spec.id}" value={fScope} options={scopeOptions} onValueChange={setFilterScope} />
      <AutocompleteInput
        value={fKey}
        options={keyOptions}
        loading={keysLoading}
        ariaLabel="Filter key {spec.id}"
        placeholder="Attribute, e.g. host.name"
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
          <span class={chip}>
            {v}
            <button type="button" class={chipX} aria-label="Remove value {v}" onclick={() => (fValues = fValues.filter((x) => x !== v))}>
              <X class="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
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
      <Button size="sm" class="h-8" disabled={!canAddFilter} onclick={commitFilter}>Add</Button>
      <Button variant="ghost" size="sm" class="h-8" onclick={() => (editor = null)}>Cancel</Button>
      {#if loadError}<span class="text-xs text-muted-foreground" role="status">{loadError}</span>{/if}
    </div>
  {:else if editor === 'group'}
    <div class="mt-2 ml-8 flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-2" role="group" aria-label="New group by {spec.id}">
      <span class="text-xs text-muted-foreground">Group by</span>
      <SelectField size="sm" class="w-32" aria-label="Group by scope {spec.id}" value={gScope} options={scopeOptions} onValueChange={setGroupScope} />
      <AutocompleteInput
        value=""
        options={groupKeyOptions}
        ariaLabel="Group by key {spec.id}"
        placeholder="Attribute, e.g. host.name"
        onOpen={() => fetchGroupKeys(gScope)}
        onCommit={addGroup}
      />
      <Button variant="ghost" size="sm" class="h-8" onclick={() => (editor = null)}>Cancel</Button>
    </div>
  {/if}
</section>
