<script lang="ts" module>
  export type HealthFilter = 'all' | 'problems' | 'inactive' | 'no_data';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Project } from '@logtide/shared';
  import type { ProjectStats } from '$lib/api/projects';
  import type { ProjectHealthSummaryEntry } from '$lib/api/project-health';
  import DataTable from '$lib/components/app/DataTable.svelte';
  import type { DataTableColumn, DataTableSort } from '$lib/components/app/data-table';
  import Sparkline from '$lib/components/app/Sparkline.svelte';
  import ProjectHealthPill, { describeHealth } from './ProjectHealthPill.svelte';
  import { buttonVariants } from '$lib/components/ui/button';
  import { writeScopeToUrl } from '$lib/stores/scope-url';
  import { formatRelative } from '$lib/utils/datetime';
  import FileText from '@lucide/svelte/icons/file-text';
  import Plug from '@lucide/svelte/icons/plug';
  import Settings from '@lucide/svelte/icons/settings';

  interface Props {
    projects: Project[];
    /** null while loading or when the stats endpoint failed: numeric cells show a dash. */
    stats: Record<string, ProjectStats> | null;
    health: Record<string, ProjectHealthSummaryEntry>;
    lastEventAt: Record<string, string | null>;
    receiving: Set<string>;
    healthFilter?: HealthFilter;
    loading?: boolean;
    empty?: Snippet;
  }

  let {
    projects,
    stats,
    health,
    lastEventAt,
    receiving,
    healthFilter = 'all',
    loading = false,
    empty,
  }: Props = $props();

  let sort = $state<DataTableSort | undefined>({ key: 'lastEvent', dir: 'desc' });

  // Error rate is only meaningful (and only colored) with enough volume.
  const MIN_LOGS_FOR_RATE = 100;

  function logsHref(id: string): string {
    const url = writeScopeToUrl(new URL('/dashboard/logs', 'http://local'), { projectIds: [id] });
    return url.pathname + url.search;
  }

  function statsOf(p: Project): ProjectStats | null {
    return stats?.[p.id] ?? null;
  }

  function errorRate(p: Project): number | null {
    const s = statsOf(p);
    if (!s || s.logs24h <= 0) return null;
    return s.errors24h / s.logs24h;
  }

  function lastEventMs(p: Project): number | null {
    const v = lastEventAt[p.id];
    if (!v) return null;
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
  }

  function isNoData(p: Project): boolean {
    const h = health[p.id];
    if (h) return h.status === 'no_data';
    return lastEventMs(p) === null && !receiving.has(p.id);
  }

  function hasProblems(p: Project): boolean {
    const h = health[p.id];
    if (!h || h.status === 'no_data') return false;
    const kind = describeHealth(h).kind;
    return kind === 'critical' || kind === 'warning';
  }

  function rateClass(p: Project): string {
    const s = statsOf(p);
    const rate = errorRate(p);
    if (!s || rate === null || s.logs24h < MIN_LOGS_FOR_RATE) return '';
    if (rate > 0.05) return 'text-red-600 dark:text-red-400 font-medium';
    if (rate > 0.01) return 'text-amber-600 dark:text-amber-400 font-medium';
    return '';
  }

  function formatRate(rate: number): string {
    const pct = rate * 100;
    if (pct === 0) return '0%';
    return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
  }

  function sortValue(p: Project, key: string): string | number | null {
    switch (key) {
      case 'name':
        return p.name.toLowerCase();
      case 'logs':
        return statsOf(p)?.logs24h ?? null;
      case 'errorRate':
        return errorRate(p);
      case 'lastEvent':
        return lastEventMs(p);
      default:
        return null;
    }
  }

  const rows = $derived.by(() => {
    let list = projects;
    if (healthFilter === 'problems') list = list.filter(hasProblems);
    else if (healthFilter === 'inactive') list = list.filter((p) => health[p.id]?.status === 'inactive');
    else if (healthFilter === 'no_data') list = list.filter(isNoData);
    if (!sort) return list;
    const { key, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = sortValue(a, key);
      const vb = sortValue(b, key);
      // Missing values always sink to the bottom, whatever the direction.
      if (va === null && vb === null) return a.name.localeCompare(b.name);
      if (va === null) return 1;
      if (vb === null) return -1;
      if (va < vb) return -1 * mul;
      if (va > vb) return 1 * mul;
      return a.name.localeCompare(b.name);
    });
  });

  // Snippets declared in the template are typed loosely by svelte-check.
  const asCell = (s: unknown) => s as Snippet<[Project]>;

  const columns: DataTableColumn<Project>[] = [
    { key: 'name', header: 'Project', sortable: true, class: 'min-w-[12rem] max-w-[22rem]', cell: asCell(nameCell) },
    { key: 'health', header: 'Health', cell: asCell(healthCell) },
    { key: 'volume', header: 'Volume 24h', class: 'hidden xl:table-cell', cell: asCell(volumeCell) },
    { key: 'logs', header: 'Logs 24h', sortable: true, class: 'text-right tabular-nums', cell: asCell(logsCell) },
    { key: 'errorRate', header: 'Error rate', sortable: true, class: 'text-right tabular-nums', cell: asCell(rateCell) },
    { key: 'incidents', header: 'Incidents', class: 'text-right tabular-nums', cell: asCell(incidentsCell) },
    { key: 'lastEvent', header: 'Last event', sortable: true, class: 'whitespace-nowrap', cell: asCell(lastEventCell) },
    { key: 'actions', header: '', class: 'w-[1%] whitespace-nowrap text-right', cell: asCell(actionsCell) },
  ];
</script>

{#snippet nameCell(p: Project)}
  <div class="min-w-0">
    <a
      href="/dashboard/projects/{p.id}"
      class="block truncate font-medium hover:text-primary hover:underline underline-offset-4"
    >
      {p.name}
    </a>
    {#if p.description}
      <p class="line-clamp-1 text-xs text-muted-foreground" title={p.description}>{p.description}</p>
    {/if}
  </div>
{/snippet}

{#snippet healthCell(p: Project)}
  <ProjectHealthPill entry={health[p.id]} />
{/snippet}

{#snippet volumeCell(p: Project)}
  {@const s = statsOf(p)}
  {#if s}
    <Sparkline values={s.hourly} width={88} label="Logs per hour for {p.name}, last 24 hours" />
  {:else}
    <span class="text-muted-foreground">-</span>
  {/if}
{/snippet}

{#snippet logsCell(p: Project)}
  {@const s = statsOf(p)}
  {#if s}{s.logs24h.toLocaleString('en-US')}{:else}<span class="text-muted-foreground">-</span>{/if}
{/snippet}

{#snippet rateCell(p: Project)}
  {@const r = errorRate(p)}
  {#if r !== null}
    <span class={rateClass(p)} data-testid="error-rate">{formatRate(r)}</span>
  {:else}
    <span class="text-muted-foreground">-</span>
  {/if}
{/snippet}

{#snippet incidentsCell(p: Project)}
  {@const s = statsOf(p)}
  {#if s}
    <span class={s.openIncidents > 0 ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground'}>
      {s.openIncidents.toLocaleString('en-US')}
    </span>
  {:else}
    <span class="text-muted-foreground">-</span>
  {/if}
{/snippet}

{#snippet lastEventCell(p: Project)}
  {@const t = lastEventAt[p.id]}
  {#if t}
    <span title={new Date(t).toLocaleString('en-US')}>{formatRelative(t)}</span>
  {:else if receiving.has(p.id)}
    <span class="text-muted-foreground">Receiving</span>
  {:else}
    <span class="text-muted-foreground">Never</span>
  {/if}
{/snippet}

{#snippet actionsCell(p: Project)}
  <div class="flex items-center justify-end gap-1">
    {#if isNoData(p)}
      <a
        href="/dashboard/projects/{p.id}/settings#connect"
        class="{buttonVariants({ variant: 'default', size: 'sm' })} gap-1"
      >
        <Plug class="size-4" />
        Connect
      </a>
    {:else}
      <a
        href={logsHref(p.id)}
        aria-label="Logs"
        title="Open logs"
        class={buttonVariants({ variant: 'outline', size: 'icon' })}
      >
        <FileText class="size-4" />
      </a>
    {/if}
    <a
      href="/dashboard/projects/{p.id}"
      aria-label="Project settings"
      title="Project settings"
      class={buttonVariants({ variant: 'ghost', size: 'icon' })}
    >
      <Settings class="size-4" />
    </a>
  </div>
{/snippet}

{#snippet mobileRow(p: Project)}
  {@const s = statsOf(p)}
  <div class="space-y-2">
    <div class="flex items-start justify-between gap-2">
      <a href="/dashboard/projects/{p.id}" class="min-w-0 truncate font-medium hover:text-primary">{p.name}</a>
      <ProjectHealthPill entry={health[p.id]} />
    </div>
    <p class="text-xs text-muted-foreground">
      {#if lastEventAt[p.id]}Last event {formatRelative(lastEventAt[p.id] as string)}{:else if receiving.has(p.id)}Receiving data{:else}No events yet{/if}
      {#if s} - {s.logs24h.toLocaleString('en-US')} logs in 24h{/if}
    </p>
    <div class="flex items-center gap-1">
      {#if isNoData(p)}
        <a
          href="/dashboard/projects/{p.id}/settings#connect"
          class="{buttonVariants({ variant: 'default', size: 'sm' })} gap-1"
        >
          <Plug class="size-4" />
          Connect
        </a>
      {:else}
        <a href={logsHref(p.id)} class="{buttonVariants({ variant: 'outline', size: 'sm' })} gap-1">
          <FileText class="size-4" />
          Logs
        </a>
      {/if}
      <a
        href="/dashboard/projects/{p.id}"
        aria-label="Project settings"
        class={buttonVariants({ variant: 'ghost', size: 'icon' })}
      >
        <Settings class="size-4" />
      </a>
    </div>
  </div>
{/snippet}

<DataTable
  {columns}
  {rows}
  {loading}
  rowKey={(p) => p.id}
  bind:sort
  mobileRow={asCell(mobileRow)}
  {empty}
/>
