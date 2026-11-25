<script lang="ts">
  // Renders the MetricQueryResponse the backend fetcher returns for a
  // `metrics` panel, in the display mode stored in the panel's query.
  import type { MetricQueryResponse, MetricsPanelConfig } from '@logtide/shared';
  import MetricSeriesView from '$lib/components/metrics/v2/MetricSeriesView.svelte';
  import { metricNamesOf, isCompactSize, chartHeightFor } from './metrics-panel';

  interface Props {
    config: MetricsPanelConfig;
    data: unknown;
    loading: boolean;
    error: string | null;
  }

  let { config, data, loading, error }: Props = $props();

  let width = $state(0);
  let height = $state(0);

  const response = $derived((data ?? null) as MetricQueryResponse | null);
  const metricNames = $derived(metricNamesOf(config));
  const compact = $derived(isCompactSize(width, height));
  const chartHeight = $derived(chartHeightFor(height));
</script>

<div
  class="h-full w-full overflow-auto {compact ? 'p-1.5' : 'p-3'}"
  data-compact={compact ? 'true' : 'false'}
  bind:clientWidth={width}
  bind:clientHeight={height}
>
  <MetricSeriesView
    {response}
    {loading}
    {error}
    display={config.query.display}
    {metricNames}
    height={chartHeight}
    showSpark={!compact}
  />
</div>
