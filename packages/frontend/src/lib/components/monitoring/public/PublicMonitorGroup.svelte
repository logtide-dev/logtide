<script lang="ts">
  import { stateTone } from '$lib/utils/severity';
  import type { PublicMonitorStatus } from '$lib/api/status-page';
  import UptimeBars from '../UptimeBars.svelte';
  import { buildDaySlots, weightedUptime } from '../uptime-bars';
  import { monitorTypeLabel } from '../monitor-meta';
  import type { MonitorGroup } from './group-monitors';

  interface Props {
    groups: MonitorGroup[];
    /** Number of day bars; the payload carries historyDays (90). */
    days?: number;
  }

  let { groups, days = 90 }: Props = $props();

  function tone(status: PublicMonitorStatus['status']) {
    return stateTone(status === 'unknown' ? 'disabled' : status);
  }

  function statusLabel(status: PublicMonitorStatus['status']): string {
    return status === 'up' ? 'Up' : status === 'down' ? 'Down' : 'Unknown';
  }

  function pctText(monitor: PublicMonitorStatus): string {
    const pct = weightedUptime(buildDaySlots(monitor.uptimeHistory, days));
    return pct === null
      ? '-'
      : `${pct.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
  }
</script>

<div class="space-y-6">
  {#each groups as group (group.name ?? '')}
    <section class="space-y-3">
      {#if group.name}
        <h2 class="text-sm font-semibold text-muted-foreground">{group.name}</h2>
      {/if}
      {#each group.monitors as monitor, i (monitor.name + '-' + i)}
        {@const slots = buildDaySlots(monitor.uptimeHistory, days)}
        <div class="rounded-lg border bg-card p-4" data-testid="public-monitor">
          <div class="mb-3 flex items-center gap-3">
            <span
              class="h-2.5 w-2.5 shrink-0 rounded-full {tone(monitor.status).dot}"
              role="img"
              aria-label={statusLabel(monitor.status)}
            ></span>
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{monitor.name}</span>
            {#if monitor.type}
              <span
                data-testid="type-chip"
                class="hidden rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:inline-flex"
              >
                {monitorTypeLabel(monitor.type as never)}
              </span>
            {/if}
            <span class="text-xs font-semibold tabular-nums {tone(monitor.status).text}" data-testid="uptime-pct">
              {pctText(monitor)}
            </span>
          </div>
          <UptimeBars {slots} dense />
        </div>
      {/each}
    </section>
  {/each}
</div>
