<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { MetricCatalogEntry } from '@logtide/shared';
  import { currentOrganization } from '$lib/stores/organization';
  import { scopeStore } from '$lib/stores/scope';
  import { layoutStore } from '$lib/stores/layout';
  import { projectsAPI } from '$lib/api/projects';
  import { metricsV2API } from '$lib/api/metrics-v2';
  import { catalogPrefixOf, exploreHrefForMetric, scopeParamsOf, scopeProjectIds } from '$lib/utils/metrics-explore';

  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import ScopeBar from '$lib/components/app/ScopeBar.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import { Input } from '$lib/components/ui/input';
  import { Badge } from '$lib/components/ui/badge';
  import MetricDetailPanel from '$lib/components/metrics/catalog/MetricDetailPanel.svelte';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import X from '@lucide/svelte/icons/x';
  import { parseCatalogSource, sourceHref } from '$lib/components/metrics/sources/source-model';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';

  const maxWidthClass = layoutStore.maxWidthClass;
  const containerPadding = layoutStore.containerPadding;

  type SortKey = 'name' | 'type' | 'unit' | 'projects' | 'lastSeen';
  const COLUMNS: Array<{ key: SortKey; label: string; class?: string }> = [
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
    { key: 'unit', label: 'Unit' },
    { key: 'projects', label: 'Projects', class: 'text-right' },
    { key: 'lastSeen', label: 'Last seen' },
  ];

  const initial = untrack(() => page.url.searchParams);
  let searchInput = $state(initial.get('search') ?? '');
  let search = $state(initial.get('search') ?? '');
  let prefix = $state(initial.get('prefix') ?? '');
  /** `host:<name>` or `service:<name>` (from a host or service page): only what that source sent. */
  let source = $state(parseCatalogSource(initial.get('source')));
  let selectedName = $state<string | null>(initial.get('metric'));
  let sortKey = $state<SortKey>('name');
  let sortDir = $state<'asc' | 'desc'>('asc');

  let projects = $state<{ id: string; name: string }[]>([]);
  let projectsOrg: string | null = null;
  $effect(() => {
    const orgId = $currentOrganization?.id;
    if (!orgId || orgId === projectsOrg) return;
    projectsOrg = orgId;
    projectsAPI
      .getProjects(orgId)
      .then((res) => {
        if (orgId === $currentOrganization?.id) projects = res.projects.map((p) => ({ id: p.id, name: p.name }));
      })
      .catch(() => {
        projects = [];
      });
  });

  // Debounce the search box.
  $effect(() => {
    const value = searchInput.trim();
    if (value === search) return;
    const timer = setTimeout(() => (search = value), 250);
    return () => clearTimeout(timer);
  });

  // ---- load ----
  const scopeIds = $derived(scopeProjectIds($scopeStore.projectIds));
  let entries = $state<MetricCatalogEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    const orgId = $currentOrganization?.id;
    const projectIds = scopeIds;
    const term = search;
    const src = source;
    if (!orgId) return;
    let cancelled = false;
    loading = true;
    error = null;
    metricsV2API
      .getCatalog({ organizationId: orgId, projectIds, search: term || undefined, source: src ? `${src.kind}:${src.name}` : undefined })
      .then((r) => {
        if (!cancelled) entries = r.metrics;
      })
      .catch((e) => {
        if (!cancelled) {
          entries = [];
          error = e instanceof Error ? e.message : 'Could not load the metric catalog';
        }
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  // ---- derived view ----
  const prefixes = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const e of entries) {
      const p = catalogPrefixOf(e.name);
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);
  });

  const rows = $derived.by(() => {
    const list = prefix ? entries.filter((e) => catalogPrefixOf(e.name) === prefix) : [...entries];
    const dir = sortDir === 'asc' ? 1 : -1;
    const value = (e: MetricCatalogEntry): string | number => {
      switch (sortKey) {
        case 'type':
          return e.type;
        case 'unit':
          return e.unit ?? '';
        case 'projects':
          return e.projectIds.length;
        case 'lastSeen':
          return Date.parse(e.lastSeen) || 0;
        default:
          return e.name;
      }
    };
    return list.sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return c * dir || a.name.localeCompare(b.name);
    });
  });

  const selected = $derived(selectedName ? (entries.find((e) => e.name === selectedName) ?? null) : null);

  function toggleSort(key: SortKey) {
    if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else {
      sortKey = key;
      sortDir = key === 'lastSeen' || key === 'projects' ? 'desc' : 'asc';
    }
  }

  // ---- URL state (search, prefix and the open metric) ----
  $effect(() => {
    const next = { search, prefix, metric: selectedName, source: source ? `${source.kind}:${source.name}` : null };
    untrack(() => {
      const url = new URL(page.url);
      for (const [k, v] of Object.entries(next)) {
        if (v) url.searchParams.set(k, v);
        else url.searchParams.delete(k);
      }
      if (url.search !== page.url.search) goto(url, { replaceState: true, keepFocus: true, noScroll: true });
    });
  });

  const scopeSearch = $derived(scopeParamsOf(page.url.searchParams));
  const exploreHref = $derived(
    selected ? exploreHrefForMetric(selected, scopeSearch) : '/dashboard/metrics/explore',
  );
</script>

<svelte:head>
  <title>Metric catalog - LogTide</title>
</svelte:head>

<div class="container mx-auto {$containerPadding} {$maxWidthClass}">
  <PageHeader title="Metric catalog" description="Every metric your sources send, with its type, unit and attributes" />


  <div class="mb-4">
    <ScopeBar mode="multi" {projects} showTime={false} hideZoneOnMobile />
  </div>

  <div class="mb-3 flex flex-wrap items-center gap-2">
    <Input
      type="search"
      class="h-9 w-72"
      placeholder="Search metrics"
      aria-label="Search metrics"
      bind:value={searchInput}
    />
    {#if source}
      <span
        class="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs"
        data-testid="catalog-source"
      >
        <span class="text-muted-foreground">{source.kind === 'host' ? 'Host' : 'Service'}</span>
        <a class="font-medium hover:underline" href={sourceHref(source.kind, source.name)}>{source.name}</a>
        <button
          type="button"
          class="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Show every source"
          onclick={() => (source = null)}
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </span>
    {/if}
    <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by prefix">
      <button
        type="button"
        class="rounded-full border px-2.5 py-1 text-xs {prefix === '' ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted'}"
        aria-pressed={prefix === ''}
        onclick={() => (prefix = '')}
      >
        All
      </button>
      {#each prefixes as [p, count] (p)}
        <button
          type="button"
          class="rounded-full border px-2.5 py-1 text-xs {prefix === p ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted'}"
          aria-pressed={prefix === p}
          onclick={() => (prefix = prefix === p ? '' : p)}
        >
          {p === 'other' ? 'other' : `${p}.`}
          <span class="ml-1 opacity-70">{count.toLocaleString('en-US')}</span>
        </button>
      {/each}
    </div>
  </div>

  {#if error}
    <EmptyState variant="error" title="Could not load the catalog" description={error} />
  {:else if loading && entries.length === 0}
    <div class="py-16 text-center text-sm text-muted-foreground" role="status">Loading metrics</div>
  {:else if rows.length === 0}
    <EmptyState
      variant={search || prefix || source ? 'no-results' : 'no-data'}
      title={search || prefix || source ? 'No metrics match' : 'No metrics yet'}
      description={search || prefix || source
        ? 'Try another search or clear the filters.'
        : 'Metrics show up here as soon as a source sends them.'}
    />
  {:else}
    <div class="overflow-x-auto rounded-lg border border-border">
      <table class="w-full text-sm" aria-label="Metrics">
        <thead>
          <tr class="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
            {#each COLUMNS as c (c.key)}
              <th
                class="px-3 py-2 font-medium {c.class ?? ''}"
                aria-sort={sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <button type="button" class="inline-flex items-center gap-1 hover:text-foreground" onclick={() => toggleSort(c.key)}>
                  {c.label}
                  {#if sortKey === c.key}
                    {#if sortDir === 'asc'}<ArrowUp class="h-3 w-3" aria-hidden="true" />{:else}<ArrowDown class="h-3 w-3" aria-hidden="true" />{/if}
                  {/if}
                </button>
              </th>
            {/each}
            <th class="px-3 py-2 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as e (e.name)}
            <tr
              class="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/40"
              data-testid="catalog-row"
              onclick={() => (selectedName = e.name)}
            >
              <td class="px-3 py-1.5">
                <button
                  type="button"
                  class="text-left font-mono text-xs hover:underline"
                  onclick={(ev) => {
                    ev.stopPropagation();
                    selectedName = e.name;
                  }}
                >
                  {e.name}
                </button>
              </td>
              <td class="px-3 py-1.5"><Badge variant="outline">{e.type}</Badge></td>
              <td class="px-3 py-1.5 text-muted-foreground">{e.unit || '-'}</td>
              <td class="px-3 py-1.5 text-right tabular-nums">{e.projectIds.length.toLocaleString('en-US')}</td>
              <td class="whitespace-nowrap px-3 py-1.5 text-muted-foreground"><Timestamp value={e.lastSeen} relative /></td>
              <td class="max-w-xs truncate px-3 py-1.5 text-muted-foreground" title={e.description ?? ''}>{e.description ?? ''}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="mt-2 text-xs text-muted-foreground">{rows.length.toLocaleString('en-US')} {rows.length === 1 ? 'metric' : 'metrics'}</p>
  {/if}

  {#if $currentOrganization}
    <MetricDetailPanel
      entry={selected}
      organizationId={$currentOrganization.id}
      projectIds={scopeIds}
      {exploreHref}
      onClose={() => (selectedName = null)}
    />
  {/if}
</div>
