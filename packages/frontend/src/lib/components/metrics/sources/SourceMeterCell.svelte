<!--
  Compact table cell for one source signal (the sources tables).

  Props:
    signal       SourceSignalValue or null (no data)
    label        accessible name
    thresholds   warning/critical for percent signals
    showSpark    draw the trend for non percent signals (default true)
    format       value formatter for non percent signals (default formatMetricValue)

  Percent signals render a narrow meter plus the value; everything else the
  value and, optionally, a small sparkline. Narrow on purpose: the hosts table
  must fit at 1280px.
-->
<script lang="ts">
  import { formatMetricValue, type SignalThreshold, type SourceSignalValue } from '@logtide/shared';
  import Sparkline from '$lib/components/app/Sparkline.svelte';
  import { DEFAULT_PERCENT_THRESHOLDS, METER_TONE_CLASS, meterTone } from '$lib/utils/metrics-series';

  interface Props {
    signal: SourceSignalValue | null;
    label: string;
    thresholds?: SignalThreshold;
    showSpark?: boolean;
    format?: (value: number, unit: string | null) => string;
  }

  let { signal, label, thresholds, showSpark = true, format }: Props = $props();

  const isPercent = $derived(signal?.unit === '%');
  const value = $derived(signal?.value ?? null);
  const pct = $derived(isPercent && value !== null ? Math.max(0, Math.min(100, value)) : null);
  const tone = $derived(value !== null && isPercent ? meterTone(value, thresholds ?? DEFAULT_PERCENT_THRESHOLDS) : 'ok');
  const sparkValues = $derived((signal?.spark ?? []).map((v) => v ?? 0));
  const text = $derived(signal && value !== null ? (format ? format(value, signal.unit) : formatMetricValue(value, signal.unit)) : null);
</script>

{#if !signal || value === null}
  <span class="text-muted-foreground" aria-label="{label}: no data">-</span>
{:else if isPercent && pct !== null}
  <div class="flex items-center gap-1.5">
    <div
      class="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-muted"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <div class="h-full rounded-full {METER_TONE_CLASS[tone]}" style:width="{pct}%"></div>
    </div>
    <span class="w-12 whitespace-nowrap text-right text-sm tabular-nums">{text}</span>
  </div>
{:else}
  <div class="flex items-center gap-2">
    <span class="whitespace-nowrap text-sm tabular-nums">{text}</span>
    {#if showSpark && sparkValues.length > 1}
      <Sparkline values={sparkValues} label="{label} trend" width={64} height={20} />
    {/if}
  </div>
{/if}
