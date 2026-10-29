<script lang="ts">
  import { stateTone } from '$lib/utils/severity';
  import { summarizeMonitors, type MonitorStatusFilter } from './monitor-meta';

  interface Props {
    monitors: Parameters<typeof summarizeMonitors>[0];
    status?: MonitorStatusFilter;
  }

  let { monitors, status = $bindable('all') }: Props = $props();

  const summary = $derived(summarizeMonitors(monitors));

  const cards = $derived([
    { key: 'all', label: 'Total', value: summary.total, text: 'text-muted-foreground' },
    { key: 'up', label: 'Up', value: summary.up, text: stateTone('up').text },
    { key: 'down', label: 'Down', value: summary.down, text: stateTone('down').text },
    { key: 'paused', label: 'Paused', value: summary.paused, text: 'text-muted-foreground' },
    { key: 'unknown', label: 'Unknown', value: summary.unknown, text: 'text-muted-foreground' },
  ] as { key: MonitorStatusFilter; label: string; value: number; text: string }[]);
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
