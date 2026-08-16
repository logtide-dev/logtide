<script lang="ts">
  import type { LiveLogStreamConfig } from '@logtide/shared';
  import { Badge } from '$lib/components/ui/badge';
  import { displayPreferences } from '$lib/stores/display-preferences';
  import { formatTimestamp } from '$lib/utils/format-time';

  interface LogRow {
    time: string;
    service: string;
    level: string;
    message: string;
    projectId: string;
    traceId?: string;
  }

  interface LiveLogStreamSnapshot {
    logs: LogRow[];
  }

  interface Props {
    config: LiveLogStreamConfig;
    data: unknown;
    loading: boolean;
    error: string | null;
  }

  let { data }: Props = $props();
  const typed = $derived(data as LiveLogStreamSnapshot | null);

  function levelVariant(level: string): 'default' | 'secondary' | 'destructive' | 'outline' {
    if (level === 'critical' || level === 'error') return 'destructive';
    if (level === 'warn') return 'outline';
    return 'secondary';
  }
</script>

<div class="h-full overflow-auto font-mono text-xs">
  {#if !typed || typed.logs.length === 0}
    <p class="text-center py-6 text-muted-foreground">No recent logs</p>
  {:else}
    <ul class="divide-y divide-border">
      {#each typed.logs as log, idx (log.time + log.service + idx)}
        <li class="px-3 py-1.5 flex items-start gap-2 hover:bg-accent/30">
          <span class="text-muted-foreground flex-shrink-0">{formatTimestamp(log.time, 'timeSeconds', $displayPreferences)}</span>
          <Badge variant={levelVariant(log.level)} class="text-[10px] uppercase flex-shrink-0">
            {log.level}
          </Badge>
          <span class="text-muted-foreground flex-shrink-0">{log.service}</span>
          <span class="truncate flex-1" title={log.message}>{log.message}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>
