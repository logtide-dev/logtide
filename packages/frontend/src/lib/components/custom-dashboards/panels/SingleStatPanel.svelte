<script lang="ts">
  import type { SingleStatConfig } from '@logtide/shared';
  import { stateTone } from '$lib/utils/severity';
  import TrendingUp from '@lucide/svelte/icons/trending-up';
  import TrendingDown from '@lucide/svelte/icons/trending-down';
  import Minus from '@lucide/svelte/icons/minus';

  interface SingleStatPanelData {
    value: number;
    trend: number;
    unit: 'count' | 'percent' | 'rate';
    metric: SingleStatConfig['metric'];
  }

  interface Props {
    config: SingleStatConfig;
    data: unknown;
    loading: boolean;
    error: string | null;
  }

  let { config, data }: Props = $props();
  const typed = $derived(data as SingleStatPanelData | null);

  function formatValue(value: number, unit: string): string {
    if (unit === 'percent') return `${value.toFixed(1)}%`;
    if (unit === 'rate') return value >= 1000 ? `${(value / 1000).toFixed(1)}K/s` : `${value.toFixed(1)}/s`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toString();
  }

  // For error_rate the convention is "lower is better": positive trend is bad.
  function trendIsPositive(metric: string, trend: number): boolean {
    if (metric === 'error_rate') return trend <= 0;
    return trend >= 0;
  }
</script>

<div class="flex flex-col justify-center items-start gap-1 p-4 h-full">
  {#if typed}
    <div class="text-3xl font-bold tracking-tight">
      {formatValue(typed.value, typed.unit)}
    </div>
    {#if config.compareWithPrevious}
      {@const positive = trendIsPositive(typed.metric, typed.trend)}
      <div
        class="flex items-center gap-1 text-xs {positive ? stateTone('ok').text : stateTone('down').text}"
      >
        {#if typed.trend === 0}
          <Minus class="w-3 h-3" />
        {:else if typed.trend > 0}
          <TrendingUp class="w-3 h-3" />
        {:else}
          <TrendingDown class="w-3 h-3" />
        {/if}
        <span>
          {typed.trend > 0 ? '+' : ''}{typed.trend.toFixed(1)}
          {typed.unit === 'percent' ? 'pp' : '%'} vs prev period
        </span>
      </div>
    {/if}
  {:else}
    <div class="text-3xl font-bold tracking-tight text-muted-foreground">-</div>
  {/if}
</div>
