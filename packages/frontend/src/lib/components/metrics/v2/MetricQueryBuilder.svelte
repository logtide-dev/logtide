<!--
  Edits a MetricExplorerQuery (queries A..F, formulas, interval, compare, display).

  Props:
    value          MetricExplorerQuery, the current query (controlled: pass back what onChange gave you,
                   or a new one to replace the draft, e.g. after loading a link)
    onChange       (query) => void, debounced
    organizationId used for catalog and attribute lookups
    from, to       ISO window for attribute key/value lookups (optional)
    variables      DashboardVariable[]; when given, "$name" is offered as a filter value
    catalog        MetricCatalogEntry[] to use instead of loading it (optional)
    api            lookup client, defaults to metricsV2API (injectable for tests)
    debounceMs     debounce of onChange, default 300 (0 = immediate)
    showDisplay    show the display toggle (default true)

  Display rule: until the user picks a display, it follows the default rule
  (split when grouping by a source attribute, lines otherwise).
-->
<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import {
    METRIC_MAX_FORMULAS,
    METRIC_MAX_QUERIES,
    METRIC_QUERY_IDS,
    type DashboardVariable,
    type MetricAttrScope,
    type MetricCatalogEntry,
    type MetricCompareTo,
    type MetricDisplay,
    type MetricExplorerQuery,
    type MetricFormulaSpec,
    type MetricQueryInterval,
    type MetricQuerySpec,
  } from '@logtide/shared';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { SelectField } from '$lib/components/ui/select';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import { metricsV2API, type MetricsV2API } from '$lib/api/metrics-v2';
  import { defaultDisplayForQuery, emptyQuerySpec } from '$lib/utils/metrics-explorer-url';
  import { validateFormula } from '$lib/utils/metrics-formula';
  import QueryRowEditor from './QueryRowEditor.svelte';
  import MetricQueryHelp from './MetricQueryHelp.svelte';

  type LookupApi = Pick<MetricsV2API, 'getCatalog' | 'getAttributes' | 'getAttributeValues'>;

  interface Props {
    value: MetricExplorerQuery;
    onChange: (query: MetricExplorerQuery) => void;
    organizationId: string;
    from?: string;
    to?: string;
    variables?: DashboardVariable[];
    catalog?: MetricCatalogEntry[];
    api?: LookupApi;
    debounceMs?: number;
    showDisplay?: boolean;
  }

  let {
    value,
    onChange,
    organizationId,
    from,
    to,
    variables,
    catalog: catalogProp,
    api = metricsV2API,
    debounceMs = 300,
    showDisplay = true,
  }: Props = $props();

  const clone = (q: MetricExplorerQuery): MetricExplorerQuery => JSON.parse(JSON.stringify(q));

  let draft = $state<MetricExplorerQuery>(clone(untrack(() => value)));
  let lastEmitted = JSON.stringify(untrack(() => value));
  let displayTouched = untrack(() => value.display !== defaultDisplayForQuery(value));
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Pick up external replacements (a loaded link, a reset) but ignore our own echo.
  $effect(() => {
    const incoming = JSON.stringify(value);
    untrack(() => {
      if (incoming === lastEmitted) return;
      lastEmitted = incoming;
      draft = clone(value);
      displayTouched = value.display !== defaultDisplayForQuery(value);
    });
  });

  function emit() {
    const snapshot = clone(draft);
    lastEmitted = JSON.stringify(snapshot);
    onChange(snapshot);
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    if (debounceMs <= 0) return emit();
    timer = setTimeout(emit, debounceMs);
  }

  onDestroy(() => {
    if (timer) clearTimeout(timer);
  });

  function update(mutator: (q: MetricExplorerQuery) => void, opts: { display?: boolean } = {}) {
    mutator(draft);
    if (!opts.display && !displayTouched && (draft.display === 'lines' || draft.display === 'split')) {
      draft.display = defaultDisplayForQuery(draft);
    }
    schedule();
  }

  // ---- catalog and attribute lookups ----
  let loadedCatalog = $state<MetricCatalogEntry[]>([]);
  let catalogError = $state<string | null>(null);
  const catalog = $derived(catalogProp ?? loadedCatalog);

  $effect(() => {
    if (catalogProp) return;
    const org = organizationId;
    const projects = draft.projectIds;
    let cancelled = false;
    untrack(() => {
      api
        .getCatalog({ organizationId: org, projectIds: projects })
        .then((r) => {
          if (!cancelled) {
            loadedCatalog = r.metrics;
            catalogError = null;
          }
        })
        .catch((e) => {
          if (!cancelled) catalogError = e instanceof Error ? e.message : 'Could not load the metric catalog';
        });
    });
    return () => {
      cancelled = true;
    };
  });

  const lookupCache = new Map<string, Promise<string[]>>();

  function cached(key: string, load: () => Promise<string[]>): Promise<string[]> {
    const hit = lookupCache.get(key);
    if (hit) return hit;
    const p = load().catch((e) => {
      lookupCache.delete(key);
      throw e;
    });
    lookupCache.set(key, p);
    return p;
  }

  function scopeParams() {
    return { organizationId, projectIds: draft.projectIds, from, to };
  }

  function loadKeys(metricName: string, scope: MetricAttrScope) {
    return cached(`k|${metricName}|${scope}|${draft.projectIds?.join(',') ?? ''}`, () =>
      api.getAttributes({ ...scopeParams(), metricName: metricName || undefined, scope }),
    );
  }

  function loadValues(metricName: string, scope: MetricAttrScope, key: string) {
    return cached(`v|${metricName}|${scope}|${key}|${draft.projectIds?.join(',') ?? ''}`, () =>
      api.getAttributeValues({ ...scopeParams(), metricName: metricName || undefined, scope, key }),
    );
  }

  // ---- queries ----
  function addQuery() {
    const used = new Set(draft.queries.map((q) => q.id));
    const id = METRIC_QUERY_IDS.find((i) => !used.has(i));
    if (!id) return;
    update((q) => q.queries.push(emptyQuerySpec(id)));
  }

  function setQuery(index: number, spec: MetricQuerySpec) {
    update((q) => (q.queries[index] = spec));
  }

  function removeQuery(index: number) {
    update((q) => q.queries.splice(index, 1));
  }

  // ---- formulas ----
  function addFormula() {
    const used = new Set(draft.formulas.map((f) => f.id));
    const id = ['F1', 'F2', 'F3', 'F4'].find((i) => !used.has(i));
    if (!id) return;
    update((q) => q.formulas.push({ id, expression: '' }));
  }

  function setFormula(index: number, patch: Partial<MetricFormulaSpec>) {
    update((q) => (q.formulas[index] = { ...q.formulas[index], ...patch }));
  }

  const queryIds = $derived(draft.queries.map((q) => q.id));

  // ---- footer ----
  const INTERVALS: Array<{ value: MetricQueryInterval; label: string }> = [
    { value: 'auto', label: 'Auto' },
    { value: '1m', label: '1 minute' },
    { value: '5m', label: '5 minutes' },
    { value: '15m', label: '15 minutes' },
    { value: '1h', label: '1 hour' },
    { value: '6h', label: '6 hours' },
    { value: '1d', label: '1 day' },
  ];
  const COMPARES: Array<{ value: MetricCompareTo; label: string }> = [
    { value: 'none', label: 'No comparison' },
    { value: '1h', label: 'Previous hour' },
    { value: '1d', label: 'Previous day' },
    { value: '1w', label: 'Previous week' },
  ];
  const DISPLAYS: Array<{ value: MetricDisplay; label: string }> = [
    { value: 'lines', label: 'Lines' },
    { value: 'area', label: 'Area' },
    { value: 'bars', label: 'Bars' },
    { value: 'split', label: 'Split' },
    { value: 'stat', label: 'Stat' },
    { value: 'table', label: 'Table' },
  ];

  function setDisplay(d: MetricDisplay) {
    displayTouched = d !== defaultDisplayForQuery(draft);
    update((q) => (q.display = d), { display: true });
  }
</script>

<div class="rounded-lg border border-border bg-card" data-testid="query-builder">
  {#if catalogError}
    <p class="border-b border-border px-3 py-2 text-xs text-muted-foreground" role="status">{catalogError}. You can still type a metric name.</p>
  {/if}

  <div class="divide-y divide-border">
    {#each draft.queries as spec, i (spec.id)}
      <QueryRowEditor
        {spec}
        {catalog}
        {variables}
        {loadKeys}
        {loadValues}
        canRemove={draft.queries.length > 1}
        onChange={(s) => setQuery(i, s)}
        onRemove={() => removeQuery(i)}
      />
    {/each}

    {#each draft.formulas as f, i (f.id)}
      {@const problem = validateFormula(f.expression, queryIds)}
      <section class="px-3 py-2.5 {f.hidden ? 'opacity-60' : ''}" aria-label="Formula {f.id}">
        <div class="flex flex-wrap items-center gap-2">
          <span class="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md bg-muted px-1 font-mono text-xs font-semibold text-muted-foreground" aria-hidden="true">{f.id}</span>
          <Input
            class="h-8 min-w-[220px] flex-1 font-mono"
            placeholder="A / B * 100"
            aria-label="Expression {f.id}"
            aria-invalid={problem !== null && f.expression.trim() !== ''}
            aria-describedby="formula-hint-{f.id}"
            value={f.expression}
            oninput={(e) => setFormula(i, { expression: e.currentTarget.value })}
          />
          <Input
            class="h-8 w-36"
            placeholder="Label"
            aria-label="Label {f.id}"
            value={f.label ?? ''}
            oninput={(e) => setFormula(i, { label: e.currentTarget.value || undefined })}
          />
          <div class="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8"
              aria-label={f.hidden ? `Show formula ${f.id}` : `Hide formula ${f.id}`}
              aria-pressed={!!f.hidden}
              onclick={() => setFormula(i, { hidden: f.hidden ? undefined : true })}
            >
              {#if f.hidden}<EyeOff class="h-4 w-4" aria-hidden="true" />{:else}<Eye class="h-4 w-4" aria-hidden="true" />{/if}
            </Button>
            <Button variant="ghost" size="icon" class="h-8 w-8" aria-label="Remove formula {f.id}" onclick={() => update((q) => q.formulas.splice(i, 1))}>
              <Trash2 class="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
        <p id="formula-hint-{f.id}" class="mt-1 pl-8 text-xs {problem ? 'text-warning-text' : 'text-muted-foreground'}">
          {problem ?? 'Use query letters, numbers, + - * / and parentheses.'}
        </p>
      </section>
    {/each}
  </div>

  <div class="flex flex-wrap items-center gap-2 border-t border-border bg-muted/30 px-3 py-2">
    <Button variant="ghost" size="sm" class="h-8" disabled={draft.queries.length >= METRIC_MAX_QUERIES} onclick={addQuery}>
      <Plus class="mr-1 h-4 w-4" aria-hidden="true" />Add query
    </Button>
    <Button variant="ghost" size="sm" class="h-8" disabled={draft.formulas.length >= METRIC_MAX_FORMULAS} onclick={addFormula}>
      <Plus class="mr-1 h-4 w-4" aria-hidden="true" />Add formula
    </Button>

    <div class="ml-auto flex flex-wrap items-center gap-2">
      {#if showDisplay}
        <div class="inline-flex rounded-md border border-border bg-background p-0.5" role="group" aria-label="Display">
          {#each DISPLAYS as d (d.value)}
            <button
              type="button"
              class="rounded px-2 py-0.5 text-xs font-medium {draft.display === d.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}"
              aria-pressed={draft.display === d.value}
              onclick={() => setDisplay(d.value)}
            >
              {d.label}
            </button>
          {/each}
        </div>
      {/if}
      <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
        Interval
        <SelectField
          size="sm"
          class="w-32"
          aria-label="Interval"
          value={draft.interval}
          options={INTERVALS}
          onValueChange={(v) => update((q) => (q.interval = v as MetricQueryInterval))}
        />
      </label>
      <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
        Compare
        <SelectField
          size="sm"
          class="w-40"
          aria-label="Compare to"
          value={draft.compareTo}
          options={COMPARES}
          onValueChange={(v) => update((q) => (q.compareTo = v as MetricCompareTo))}
        />
      </label>
      <MetricQueryHelp />
    </div>
  </div>
</div>

