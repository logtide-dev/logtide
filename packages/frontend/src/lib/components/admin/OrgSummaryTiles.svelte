<script lang="ts">
  import Skeleton from '$lib/components/ui/skeleton/skeleton.svelte';
  import { formatCount, formatCompact } from '$lib/utils/format-number';

  interface Props {
    memberCount: number;
    projectCount: number;
    /** Sum of project logs over the last 30 days; null while loading or unavailable. */
    logs30d: number | null;
    logs30dLoading?: boolean;
    retentionDays: number;
  }

  let { memberCount, projectCount, logs30d, logs30dLoading = false, retentionDays }: Props = $props();

  const tiles = $derived([
    { id: 'members', label: 'Members', value: formatCount(memberCount), href: '#members', hint: null as string | null },
    { id: 'projects', label: 'Projects', value: formatCount(projectCount), href: '#projects', hint: null },
    {
      id: 'logs',
      label: 'Logs, last 30 days',
      value: formatCompact(logs30d),
      href: '#projects',
      hint: logs30d !== null ? `${formatCount(logs30d)} total` : null,
    },
    {
      id: 'retention',
      label: 'Log retention',
      value: `${formatCount(retentionDays)} ${retentionDays === 1 ? 'day' : 'days'}`,
      href: '#retention',
      hint: null,
    },
  ]);
</script>

<ul class="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Organization summary" data-testid="org-summary-tiles">
  {#each tiles as tile (tile.id)}
    <li class="min-w-0">
      <a
        href={tile.href}
        data-testid="org-tile-{tile.id}"
        class="block h-full rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <p class="text-xs font-medium text-muted-foreground">{tile.label}</p>
        {#if tile.id === 'logs' && logs30dLoading}
          <Skeleton class="mt-2 h-6 w-16" />
        {:else}
          <p class="mt-1 truncate text-xl font-semibold tabular-nums {tile.value === '-' ? 'text-muted-foreground' : ''}">
            {tile.value}
          </p>
        {/if}
        {#if tile.hint}
          <p class="truncate text-xs text-muted-foreground">{tile.hint}</p>
        {/if}
      </a>
    </li>
  {/each}
</ul>
