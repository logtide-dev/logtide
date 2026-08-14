<script lang="ts">
  import type { TopNTableConfig } from '@logtide/shared';
  import { Badge } from '$lib/components/ui/badge';
  import { formatTimestamp } from '$lib/utils/format-time';
  import { displayPreferences } from '$lib/stores/display-preferences';

  interface TopNRow {
    key: string;
    count: number;
    percentage: number;
    lastSeen?: string;
  }

  interface TopNTableData {
    rows: TopNRow[];
    total: number;
  }

  interface Props {
    config: TopNTableConfig;
    data: unknown;
    loading: boolean;
    error: string | null;
  }

  let { config, data }: Props = $props();
  const typed = $derived(data as TopNTableData | null);
  // Only the topValues-backed dimensions can carry a last seen time; the header
  // and the cells appear together or not at all.
  const hasLastSeen = $derived(typed?.rows.some((r) => r.lastSeen) ?? false);
</script>

<div class="h-full overflow-auto">
  {#if !typed || typed.rows.length === 0}
    <p class="text-sm text-muted-foreground text-center py-6">No data</p>
  {:else}
    {#if hasLastSeen}
      <div class="flex items-center gap-3 border-b border-border px-3 py-1 text-xs font-medium text-muted-foreground">
        <span class="min-w-0 flex-1"></span>
        <span class="w-28 flex-shrink-0 text-right">Last seen</span>
        <span class="w-14 flex-shrink-0"></span>
      </div>
    {/if}
    <ul class="divide-y divide-border">
      {#each typed.rows as row, idx (row.key + idx)}
        <li class="flex items-center justify-between gap-3 px-3 py-2 hover:bg-accent/30">
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <span class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              {idx + 1}
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium truncate" title={row.key}>{row.key}</p>
              <p class="text-xs text-muted-foreground">
                {row.count.toLocaleString('en-US')}
                {config.dimension === 'service' ? 'logs' : 'occurrences'}
              </p>
            </div>
          </div>
          {#if hasLastSeen}
            <span class="w-28 flex-shrink-0 text-right text-xs text-muted-foreground">
              {row.lastSeen ? formatTimestamp(row.lastSeen, 'dateTime', $displayPreferences) : '-'}
            </span>
          {/if}
          <Badge variant="secondary" class="w-14 flex-shrink-0 justify-center">{row.percentage}%</Badge>
        </li>
      {/each}
    </ul>
  {/if}
</div>
