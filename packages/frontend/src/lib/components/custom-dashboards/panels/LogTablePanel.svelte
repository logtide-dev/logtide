<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import type { LogTableConfig, BuiltinLogColumn } from '@logtide/shared';
  import { resolveMetadataPath, formatMetadataCell } from '@logtide/shared';
  import { logsAPI } from '$lib/api/logs';
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

  interface WsLog {
    id: string;
    time: string;
    projectId: string;
    service: string;
    level: string;
    message: string;
    metadata?: Record<string, unknown>;
  }

  interface Props {
    config: LogTableConfig;
    data: unknown;
    loading: boolean;
    error: string | null;
  }

  let { config, data }: Props = $props();

  const isLive = config.mode === 'live' && config.projectId !== null;

  let liveRows = $state<LogTableRow[]>([]);
  let liveStatus = $state<'connecting' | 'live' | 'reconnecting' | 'failed'>('connecting');
  let ws: WebSocket | null = null;
  let destroyed = false;
  let retries = 0;
  const MAX_RETRIES = 5;

  const snapshot = $derived(data as LogTableSnapshot | null);
  const rows = $derived(isLive ? liveRows : (snapshot?.logs ?? []));

  function toRow(log: WsLog): LogTableRow {
    return {
      id: log.id,
      projectId: log.projectId,
      time: log.time,
      level: log.level,
      service: log.service,
      message: log.message,
      cells: config.columns.map((col) =>
        formatMetadataCell(resolveMetadataPath(log.metadata, col))
      ),
    };
  }

  async function connect() {
    if (destroyed || !config.projectId) return;
    try {
      const socket = await logsAPI.createLogsWebSocket({
        projectId: config.projectId,
        service: config.service ?? undefined,
      });
      if (destroyed) {
        socket.close();
        return;
      }
      ws = socket;
      liveStatus = 'live';
      retries = 0;
      socket.onmessage = (ev) => {
        let parsed: { type?: string; logs?: WsLog[] };
        try {
          parsed = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        if (parsed.type !== 'logs' || !Array.isArray(parsed.logs)) return;
        // The WS helper only forwards a single level filter, so multi-level
        // configs filter here on the client.
        const incoming = parsed.logs.filter(
          (l) => config.levels.length === 0 || (config.levels as string[]).includes(l.level)
        );
        if (incoming.length === 0) return;
        // Newest first, capped at maxRows.
        liveRows = [...incoming.map(toRow).reverse(), ...liveRows].slice(0, config.maxRows);
      };
      socket.onclose = () => scheduleReconnect();
      socket.onerror = () => socket.close();
    } catch {
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (destroyed) return;
    ws = null;
    if (retries >= MAX_RETRIES) {
      liveStatus = 'failed';
      return;
    }
    retries += 1;
    liveStatus = 'reconnecting';
    setTimeout(connect, Math.min(1000 * 2 ** retries, 15000));
  }

  onMount(() => {
    if (isLive) void connect();
    return () => {
      destroyed = true;
      ws?.close();
    };
  });

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
  {#if isLive}
    <div class="flex items-center gap-1.5 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
      <span
        class="inline-block w-1.5 h-1.5 rounded-full {liveStatus === 'live'
          ? 'bg-emerald-500'
          : liveStatus === 'failed'
            ? 'bg-destructive'
            : 'bg-amber-500 animate-pulse'}"
      ></span>
      {liveStatus === 'live' ? 'live' : liveStatus === 'failed' ? 'stream unavailable' : 'connecting'}
    </div>
  {/if}
  {#if rows.length === 0}
    <p class="text-center py-6 text-sm text-muted-foreground">
      {isLive ? 'Waiting for logs' : 'No logs in range'}
    </p>
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
