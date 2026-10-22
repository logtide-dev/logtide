<script lang="ts">
  import { stateTone } from '$lib/utils/severity';
  import { formatBucketDay, type DaySlot } from './uptime-bars';

  interface Props {
    slots: DaySlot[];
    /** Thinner bars for the public status page. */
    dense?: boolean;
  }

  let { slots, dense = false }: Props = $props();

  const up = stateTone('up');
  const down = stateTone('down');

  function cellClass(slot: DaySlot): string {
    if (slot.uptimePct === null) return 'bg-muted';
    if (slot.uptimePct >= 99) return up.dot;
    if (slot.uptimePct >= 95) return 'bg-warning';
    return down.dot;
  }

  function cellTitle(slot: DaySlot): string {
    const day = `${formatBucketDay(slot.day)} (UTC)`;
    if (slot.uptimePct === null || !('totalChecks' in slot)) return `${day}: No data`;
    const pct = slot.uptimePct.toLocaleString('en-US', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    });
    return `${day}: ${pct}% (${slot.totalChecks.toLocaleString('en-US')} checks)`;
  }
</script>

<div
  role="img"
  aria-label="Uptime for each of the last {slots.length} days, by UTC day"
  class="flex items-stretch gap-0.5 {dense ? 'h-8' : 'h-12'}"
>
  {#each slots as slot (slot.day)}
    <div
      data-testid="uptime-cell"
      title={cellTitle(slot)}
      class="min-w-px flex-1 rounded-sm {cellClass(slot)}"
    ></div>
  {/each}
</div>
<div class="mt-1.5 flex justify-between text-xs text-muted-foreground">
  <span>{slots.length.toLocaleString('en-US')} days ago</span>
  <span>Today</span>
</div>
