<!--
  Table cell content for one source signal.

  Props:
    signal      SourceSignalValue ({ value, unit, spark }) or null (no data)
    label       accessible name, e.g. "CPU"
    thresholds  warning/critical for percent signals (default: CPU thresholds);
                pass thresholds for a non percent signal to color its value text
    showSpark   draw the trend for non percent signals (default true)

  Percent signals (unit "%") render a meter bar colored by thresholds plus the
  value. Everything else renders the formatted value and a sparkline.
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
  }

  let { signal, label, thresholds, showSpark = true }: Props = $props();

  const isPercent = $derived(signal?.unit === '%');
  const value = $derived(signal?.value ?? null);
  const pct = $derived(isPercent && value !== null ? Math.max(0, Math.min(100, value)) : null);
  const tone = $derived(value !== null && isPercent ? meterTone(value, thresholds ?? DEFAULT_PERCENT_THRESHOLDS) : 'ok');
  const sparkValues = $derived((signal?.spark ?? []).map((v) => v ?? 0));
  const text = $derived(signal && value !== null ? formatMetricValue(value, signal.unit) : null);
</script>

{#if !signal || value === null}
  <span class="text-muted-foreground" aria-label="{label}: no data">-</span>
{:else if isPercent && pct !== null}
  <div class="flex items-center gap-2">
    <div
      class="h-2 w-20 overflow-hidden rounded-full bg-muted"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <div class="h-full rounded-full {METER_TONE_CLASS[tone]}" style:width="{pct}%"></div>
    </div>
    <span class="w-14 text-right text-sm tabular-nums">{text}</span>
  </div>
{:else}
  <div class="flex items-center gap-2">
    <span class="min-w-14 text-sm tabular-nums">{text}</span>
    {#if showSpark && sparkValues.length > 1}
      <Sparkline values={sparkValues} label="{label} trend" width={80} height={22} />
    {/if}
  </div>
{/if}
