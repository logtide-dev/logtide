<script lang="ts">
  import type { HardwareHostSummary } from '@logtide/shared';
  import { hardwareStatusTone, summarizeHosts, type HardwareStatusFilter } from './hardware-meta';

  interface Props {
    hosts: Pick<HardwareHostSummary, 'status'>[];
    status?: HardwareStatusFilter;
  }

  let { hosts, status = $bindable('all') }: Props = $props();

  const summary = $derived(summarizeHosts(hosts));

  const cards = $derived([
    { key: 'all', label: 'Hosts', value: summary.total, text: 'text-muted-foreground' },
    { key: 'ok', label: 'OK', value: summary.ok, text: hardwareStatusTone('ok').text },
    { key: 'warning', label: 'Warning', value: summary.warning, text: hardwareStatusTone('warning').text },
    { key: 'critical', label: 'Critical', value: summary.critical, text: hardwareStatusTone('critical').text },
    { key: 'stale', label: 'Stale', value: summary.stale, text: 'text-muted-foreground' },
  ] as { key: HardwareStatusFilter; label: string; value: number; text: string }[]);
</script>

<div class="grid grid-cols-2 gap-3 sm:grid-cols-5">
  {#each cards as card (card.key)}
    <button
      type="button"
      aria-pressed={status === card.key}
      class="rounded-lg border bg-card p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {status ===
      card.key
        ? 'ring-2 ring-primary'
        : 'hover:border-primary/50'}"
      onclick={() => (status = card.key)}
    >
      <p class="text-xs font-medium {card.text}">{card.label}</p>
      <p class="text-2xl font-bold" data-testid="summary-{card.key}">
        {card.value.toLocaleString('en-US')}
      </p>
    </button>
  {/each}
</div>
