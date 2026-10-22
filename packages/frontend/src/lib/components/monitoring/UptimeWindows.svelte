<script lang="ts">
  import type { UptimeSummary, UptimeWindowKey } from '$lib/api/monitoring';

  interface Props {
    windows: UptimeSummary['windows'];
  }

  let { windows }: Props = $props();

  const ORDER: { key: UptimeWindowKey; label: string }[] = [
    { key: '24h', label: 'Last 24 hours' },
    { key: '7d', label: 'Last 7 days' },
    { key: '30d', label: 'Last 30 days' },
    { key: '90d', label: 'Last 90 days' },
  ];

  function pct(value: number | null | undefined): string {
    if (value == null) return '-';
    return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  }

  function checks(n: number): string {
    return `${n.toLocaleString('en-US')} ${n === 1 ? 'check' : 'checks'}`;
  }
</script>

<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
  {#each ORDER as item (item.key)}
    {@const w = windows?.[item.key]}
    <div class="rounded-lg border bg-card p-4" data-testid="uptime-window-{item.key}">
      <p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">{item.label}</p>
      <p class="mt-2 text-2xl font-semibold" data-testid="uptime-value-{item.key}">
        {pct(w?.uptimePct)}
      </p>
      <p class="mt-1 text-xs text-muted-foreground">
        {w && w.totalChecks > 0 ? checks(w.totalChecks) : 'No data yet'}
      </p>
    </div>
  {/each}
</div>
<p class="text-xs text-muted-foreground">
  The 24 hour and 7 day figures use every check. The 30 and 90 day figures use daily totals in UTC.
</p>
