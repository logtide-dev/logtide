<script lang="ts">
  import { goto } from '$app/navigation';
  import type { LogTableConfig, BuiltinLogColumn } from '@logtide/shared';
  import { Badge } from '$lib/components/ui/badge';

  interface LogTableRow {
    id: string;
    projectId: string;
    time: string;
    level: string;
    service: string;
    message: string;
    cells: (string | null)[];
  }

  interface LogTableSnapshot {
    logs: LogTableRow[];
  }

  interface Props {
    config: LogTableConfig;
    data: unknown;
    loading: boolean;
    error: string | null;
  }

  let { config, data }: Props = $props();

  const snapshot = $derived(data as LogTableSnapshot | null);
  const rows = $derived(snapshot?.logs ?? []);

  const BUILTIN_LABELS: Record<BuiltinLogColumn, string> = {
    time: 'Time',
    level: 'Level',
    service: 'Service',
    message: 'Message',
  };
  const builtins = $derived(config.builtinColumns);

  // Single-line + ellipsis by default; wrapCells trades scanning density
  // for full values (the Search table's fixed truncation was the complaint
  // that motivated this panel, see issue #289).
  const cellClass = $derived(
    config.wrapCells
      ? 'whitespace-pre-wrap break-all align-top'
      : 'whitespace-nowrap truncate max-w-[28rem]'
  );

  function formatTime(time: string): string {
    return new Date(time).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }

  function levelVariant(level: string): 'default' | 'secondary' | 'destructive' | 'outline' {
    if (level === 'critical' || level === 'error') return 'destructive';
    if (level === 'warn') return 'outline';
    return 'secondary';
  }

  function openLog(row: LogTableRow) {
    if (!row.id || !row.projectId) return;
    goto(`/dashboard/search?logId=${row.id}&projectId=${row.projectId}`);
  }
</script>

<div class="h-full overflow-auto">
  {#if rows.length === 0}
    <p class="text-center py-6 text-sm text-muted-foreground">No logs in range</p>
  {:else}
    <table class="w-full text-xs font-mono">
      <thead class="sticky top-0 bg-card text-muted-foreground">
        <tr class="border-b border-border text-left">
          {#each builtins as col (col)}
            <th class="px-2 py-1.5 font-medium">{BUILTIN_LABELS[col]}</th>
          {/each}
          {#each config.columns as col (col)}
            <th class="px-2 py-1.5 font-medium">{col}</th>
          {/each}
        </tr>
      </thead>
      <tbody class="divide-y divide-border">
        {#each rows as row (row.id)}
          <tr class="cursor-pointer hover:bg-accent/30" onclick={() => openLog(row)}>
            {#each builtins as col (col)}
              {#if col === 'time'}
                <td class="px-2 py-1 text-muted-foreground whitespace-nowrap">{formatTime(row.time)}</td>
              {:else if col === 'level'}
                <td class="px-2 py-1">
                  <Badge variant={levelVariant(row.level)} class="text-[10px] uppercase">{row.level}</Badge>
                </td>
              {:else if col === 'service'}
                <td class="px-2 py-1 text-muted-foreground whitespace-nowrap">{row.service}</td>
              {:else}
                <td class="px-2 py-1 {cellClass}" title={config.wrapCells ? undefined : row.message}>{row.message}</td>
              {/if}
            {/each}
            {#each row.cells as cell, i (i)}
              <td class="px-2 py-1 {cellClass}" title={config.wrapCells || cell === null ? undefined : cell}>
                {#if cell !== null}
                  {cell}
                {:else}
                  <span class="text-muted-foreground">-</span>
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
