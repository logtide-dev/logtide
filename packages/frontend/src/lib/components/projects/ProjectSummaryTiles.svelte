<script lang="ts" module>
  function formatCount(n: number | null): string {
    return n === null ? '-' : n.toLocaleString('en-US');
  }
</script>

<script lang="ts">
  import { formatLatency, formatPct, scopedHref } from './summary-format';
  import type { ProjectSummary } from '$lib/api/projects';
  import Skeleton from '$lib/components/ui/skeleton/skeleton.svelte';

  interface Props {
    projectId: string;
    /** null while loading or when the whole request failed: every tile shows `-`. */
    summary: ProjectSummary | null;
    loading?: boolean;
  }

  let { projectId, summary, loading = false }: Props = $props();

  const tiles = $derived.by(() => {
    const s = summary;
    const noMonitors = s?.monitorCount === 0;
    return [
      {
        id: 'logs',
        label: 'Logs 24h',
        value: formatCount(s?.logs24h ?? null),
        sub: null as string | null,
        href: scopedHref('/dashboard/logs', projectId),
        tone: '',
      },
      {
        id: 'errors',
        label: 'Open errors',
        value: formatCount(s?.openErrorGroups ?? null),
        sub: null,
        href: scopedHref('/dashboard/errors', projectId),
        tone: (s?.openErrorGroups ?? 0) > 0 ? 'text-amber-700 dark:text-amber-400' : '',
      },
      {
        id: 'traces',
        label: 'Traces p95',
        value: formatLatency(s?.tracesP95Ms ?? null),
        sub: null,
        href: scopedHref('/dashboard/traces', projectId),
        tone: '',
      },
      {
        id: 'uptime',
        label: 'Uptime 30d',
        value: noMonitors ? 'No monitors' : formatPct(s?.uptime30dPct ?? null),
        sub: noMonitors ? 'Create one' : null,
        href: scopedHref('/dashboard/uptime', projectId),
        tone: '',
      },
      {
        id: 'incidents',
        label: 'Open incidents',
        value: formatCount(s?.openIncidents ?? null),
        sub: null,
        href: scopedHref('/dashboard/incidents', projectId),
        tone: (s?.openIncidents ?? 0) > 0 ? 'text-red-700 dark:text-red-400' : '',
      },
    ];
  });
</script>

<ul
  class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
  aria-label="Project summary"
  data-testid="project-summary-tiles"
>
  {#each tiles as tile (tile.id)}
    <li class="min-w-0 last:max-sm:col-span-2">
      <a
        href={tile.href}
        data-testid="summary-tile-{tile.id}"
        class="group block h-full rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <p class="text-xs font-medium text-muted-foreground">{tile.label}</p>
        {#if loading && !summary}
          <Skeleton class="mt-2 h-6 w-16" />
        {:else}
          <p
            class="mt-1 truncate text-xl font-semibold tabular-nums {tile.tone} {tile.value === '-' ? 'text-muted-foreground' : ''}"
            data-testid="summary-tile-value"
          >
            {tile.value}
          </p>
        {/if}
        {#if tile.sub}
          <p class="text-xs text-primary group-hover:underline">{tile.sub}</p>
        {/if}
      </a>
    </li>
  {/each}
</ul>
