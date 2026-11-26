<!--
  One activity chart of the Traces tab: requests (OK and errors stacked) or p95 latency.

  Props:
    variant         'requests' | 'latency'
    buckets         SourceTraceBucket[], oldest first
    bucketSeconds   bucket width
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import * as echarts from 'echarts';
  import type { SourceTraceBucket } from '@logtide/shared';
  import { themeStore } from '$lib/stores/theme';
  import { displayPreferences } from '$lib/stores/display-preferences';
  import { levelTone } from '$lib/utils/severity';
  import { formatTimestamp } from '$lib/utils/datetime';
  import { buildLatencyOption, buildRequestsOption } from './source-traces';

  interface Props {
    variant: 'requests' | 'latency';
    buckets: SourceTraceBucket[];
    bucketSeconds: number;
  }

  let { variant, buckets, bucketSeconds }: Props = $props();

  const DAY_MS = 86_400_000;
  let el: HTMLDivElement;
  let chart: echarts.ECharts | null = null;

  function option() {
    const span = buckets.length > 0 ? Date.parse(buckets[buckets.length - 1].time) - Date.parse(buckets[0].time) : 0;
    const input = {
      buckets,
      bucketSeconds,
      colors: { ok: levelTone('info').chart, error: levelTone('error').chart, latency: levelTone('warn').chart },
      formatAxis: (ms: number) => formatTimestamp(ms, { precision: 'minute', withDate: span > DAY_MS }),
    };
    return variant === 'requests' ? buildRequestsOption(input) : buildLatencyOption(input);
  }

  function redraw() {
    chart?.setOption(option(), true);
  }

  onMount(() => {
    chart = echarts.init(el);
    chart.setOption(option());
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => chart?.resize()) : null;
    observer?.observe(el);
    const unsubTheme = themeStore.subscribe(() => redraw());
    const unsubPrefs = displayPreferences.subscribe(() => redraw());
    return () => {
      observer?.disconnect();
      unsubTheme();
      unsubPrefs();
      chart?.dispose();
      chart = null;
    };
  });

  $effect(() => {
    buckets;
    bucketSeconds;
    variant;
    redraw();
  });
</script>

<div
  bind:this={el}
  class="h-36 w-full"
  role="img"
  aria-label={variant === 'requests' ? 'Requests and errors over time' : 'p95 latency over time'}
></div>
