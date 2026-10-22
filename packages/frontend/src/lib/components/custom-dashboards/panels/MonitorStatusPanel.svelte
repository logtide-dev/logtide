<script lang="ts">
  import type { MonitorStatusConfig } from '@logtide/shared';
  import { stateTone } from '$lib/utils/severity';
  import { Badge } from '$lib/components/ui/badge';
  import CheckCircle from '@lucide/svelte/icons/check-circle-2';
  import XCircle from '@lucide/svelte/icons/x-circle';
  import HelpCircle from '@lucide/svelte/icons/help-circle';

  interface MonitorEntry {
    id: string;
    name: string;
    type: string;
    status: string | null;
    enabled: boolean;
    lastCheckedAt: string | null;
    responseTimeMs: number | null;
    consecutiveFailures: number;
    severity: string;
  }

  interface MonitorStatusData {
    monitors: MonitorEntry[];
    totalUp: number;
    totalDown: number;
    totalUnknown: number;
  }

  interface Props {
    config: MonitorStatusConfig;
    data: unknown;
    loading: boolean;
    error: string | null;
  }

  let { data }: Props = $props();
  const typed = $derived(data as MonitorStatusData | null);

  function relTime(t: string | null): string {
    if (!t) return 'never';
    const diff = Date.now() - new Date(t).getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  }
</script>

<div class="h-full overflow-auto">
  {#if !typed || typed.monitors.length === 0}
    <p class="text-sm text-muted-foreground text-center py-6">No monitors configured</p>
  {:else}
    <div class="px-3 pt-2 pb-1 flex items-center gap-3 text-xs">
      <span class="flex items-center gap-1 {stateTone('ok').text}">
        <CheckCircle class="w-3.5 h-3.5" /> {typed.totalUp} up
      </span>
      <span class="flex items-center gap-1 {stateTone('down').text}">
        <XCircle class="w-3.5 h-3.5" /> {typed.totalDown} down
      </span>
      {#if typed.totalUnknown > 0}
        <span class="flex items-center gap-1 text-muted-foreground">
          <HelpCircle class="w-3.5 h-3.5" /> {typed.totalUnknown} unknown
        </span>
      {/if}
    </div>
    <ul class="divide-y divide-border">
      {#each typed.monitors as m (m.id)}
        <li class="flex items-center justify-between gap-3 px-3 py-2">
          <div class="flex items-center gap-2 min-w-0 flex-1">
            {#if m.status === 'up'}
              <CheckCircle class="w-4 h-4 {stateTone('ok').text} flex-shrink-0" />
            {:else if m.status === 'down'}
              <XCircle class="w-4 h-4 {stateTone('down').text} flex-shrink-0" />
            {:else}
              <HelpCircle class="w-4 h-4 text-muted-foreground flex-shrink-0" />
            {/if}
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium truncate" title={m.name}>{m.name}</p>
              <p class="text-xs text-muted-foreground">
                {m.type} - last check {relTime(m.lastCheckedAt)}
              </p>
            </div>
          </div>
          {#if m.responseTimeMs != null}
            <Badge variant="secondary" class="flex-shrink-0">{m.responseTimeMs}ms</Badge>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
