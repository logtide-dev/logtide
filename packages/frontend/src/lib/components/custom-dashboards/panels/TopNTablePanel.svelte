<script lang="ts">
  import type { TopNTableConfig } from '@logtide/shared';
  import { Badge } from '$lib/components/ui/badge';

  interface TopNRow {
    key: string;
    count: number;
    percentage: number;
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
</script>

<div class="h-full overflow-auto">
  {#if !typed || typed.rows.length === 0}
    <p class="text-sm text-muted-foreground text-center py-6">No data</p>
  {:else}
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
          <Badge variant="secondary" class="flex-shrink-0">{row.percentage}%</Badge>
        </li>
      {/each}
    </ul>
  {/if}
</div>
