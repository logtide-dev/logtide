<!--
  Side list of the metric catalog: every host and service of the projects in
  scope, whether it is sending data and how many metrics it sends. It reads the
  cheap source index (two storage reads), not the health of each source. Picking one filters the
  catalog on it; picking it again (or "All sources") clears the filter.

  Props:
    organizationId   organization of the page
    projectIds       projects in scope (null = every project)
    selected         the source the catalog is filtered on, or null
    onSelect         called with the new source, or null for every source
-->
<script lang="ts">
  import type { MetricSourceKind } from '@logtide/shared';
  import { metricsV2API } from '$lib/api/metrics-v2';
  import Input from '$lib/components/ui/input/input.svelte';
  import Server from '@lucide/svelte/icons/server';
  import Box from '@lucide/svelte/icons/box';
  import Layers from '@lucide/svelte/icons/layers';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Search from '@lucide/svelte/icons/search';

  interface SourceRef {
    kind: MetricSourceKind;
    name: string;
  }

  interface Props {
    organizationId: string;
    projectIds: string[] | null;
    selected: SourceRef | null;
    onSelect: (source: SourceRef | null) => void;
  }

  let { organizationId, projectIds, selected, onSelect }: Props = $props();

  interface Row {
    name: string;
    live: boolean;
    metricCount: number;
  }

  const WINDOW_MS = 24 * 3600_000;

  let hosts = $state<Row[]>([]);
  let services = $state<Row[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let filter = $state('');
  let collapsed = $state<Record<MetricSourceKind, boolean>>({ host: false, service: false });

  $effect(() => {
    const orgId = organizationId;
    const ids = projectIds;
    let cancelled = false;
    loading = true;
    error = null;
    const to = new Date();
    metricsV2API
      .getSourceIndex({ organizationId: orgId, projectIds: ids, from: new Date(to.getTime() - WINDOW_MS).toISOString(), to: to.toISOString() })
      .then((res) => {
        if (cancelled) return;
        // The catalog is about metrics: a source that sent none (traces only) has nothing to show.
        const rows = (list: Row[]) =>
          list
            .filter((s) => s.metricCount > 0)
            .map((s) => ({ name: s.name, live: s.live, metricCount: s.metricCount }));
        hosts = rows(res.hosts);
        services = rows(res.services);
      })
      .catch((e) => {
        if (cancelled) return;
        hosts = [];
        services = [];
        error = e instanceof Error ? e.message : 'Could not load the sources';
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  const q = $derived(filter.trim().toLowerCase());
  const groups = $derived([
    { kind: 'host' as const, label: 'Hosts', icon: Server, rows: hosts.filter((r) => r.name.toLowerCase().includes(q)), total: hosts.length },
    { kind: 'service' as const, label: 'Services', icon: Box, rows: services.filter((r) => r.name.toLowerCase().includes(q)), total: services.length },
  ]);

  const isSelected = (kind: MetricSourceKind, name: string) => selected?.kind === kind && selected.name === name;

  function pick(kind: MetricSourceKind, name: string) {
    onSelect(isSelected(kind, name) ? null : { kind, name });
  }

  const itemBase =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const itemIdle = 'text-muted-foreground hover:bg-accent/50 hover:text-foreground';
  const itemOn = 'bg-nav-active text-nav-active-foreground font-medium';
</script>

<!-- The search sits outside the box, on the row of the catalog search. -->
<nav class="flex flex-col gap-3" aria-label="Sources" data-testid="catalog-sources">
  <div class="relative">
    <Search class="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
    <Input class="h-9 pl-8" placeholder="Search sources" aria-label="Search sources" bind:value={filter} />
  </div>
  <div class="flex flex-col gap-1 rounded-lg border border-border bg-card p-2">

  <button type="button" class="{itemBase} {selected === null ? itemOn : itemIdle}" aria-pressed={selected === null} onclick={() => onSelect(null)}>
    <Layers class="h-4 w-4 shrink-0" aria-hidden="true" />
    <span class="flex-1 truncate">All sources</span>
  </button>

  {#if loading && hosts.length === 0 && services.length === 0}
    <p class="px-2 py-3 text-xs text-muted-foreground" role="status">Loading sources</p>
  {:else if error}
    <p class="px-2 py-3 text-xs text-destructive-text" role="alert">{error}</p>
  {:else}
    {#each groups as g (g.kind)}
      {#if g.total > 0}
        <div>
          <button
            type="button"
            class="flex w-full items-center gap-1 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
            aria-expanded={!collapsed[g.kind]}
            onclick={() => (collapsed = { ...collapsed, [g.kind]: !collapsed[g.kind] })}
          >
            <ChevronRight class="h-3 w-3 transition-transform {collapsed[g.kind] ? '' : 'rotate-90'}" aria-hidden="true" />
            <span class="flex-1 text-left">{g.label}</span>
            <span class="tabular-nums font-normal">{g.total}</span>
          </button>
          {#if !collapsed[g.kind]}
            <ul class="space-y-0.5" aria-label={g.label}>
              {#each g.rows as r (r.name)}
                {@const on = isSelected(g.kind, r.name)}
                <li>
                  <button type="button" class="{itemBase} {on ? itemOn : itemIdle}" aria-pressed={on} onclick={() => pick(g.kind, r.name)} data-testid="source-{g.kind}-{r.name}">
                    <g.icon class="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
                    <span class="flex-1 truncate" title={r.name}>{r.name}</span>
                    <span
                      class="h-2 w-2 shrink-0 rounded-full {r.live ? 'bg-success' : 'bg-muted-foreground/40'}"
                      title={r.live ? 'Sending data' : 'No data in the last minutes'}
                      aria-label={r.live ? 'Sending data' : 'Not sending'}
                    ></span>
                    <span class="w-7 text-right text-xs tabular-nums opacity-70" title="{r.metricCount} metrics">{r.metricCount}</span>
                  </button>
                </li>
              {:else}
                <li class="px-2 py-1 text-xs text-muted-foreground">No match</li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    {/each}
    {#if hosts.length === 0 && services.length === 0}
      <p class="px-2 py-3 text-xs text-muted-foreground">No hosts or services in these projects.</p>
    {/if}
  {/if}
  </div>
</nav>
