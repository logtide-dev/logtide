<script lang="ts">
  import * as echarts from 'echarts';
  import { levelTone } from '$lib/utils/severity';
  import { formatTimestamp } from '$lib/utils/datetime';
  import { displayPreferences } from '$lib/stores/display-preferences';

  interface Props {
    counts: number[];
    /** ISO start of the first bucket */
    from: string;
    bucketMs: number;
  }

  let { counts, from, bucketMs }: Props = $props();

  let container = $state<HTMLDivElement | null>(null);
  let chart = $state.raw<echarts.ECharts | null>(null);

  const color = levelTone('error').chart;

  function buildOption(data: number[], start: string, step: number): echarts.EChartsOption {
    const t0 = new Date(start).getTime();
    const labels = data.map((_, i) => formatTimestamp(new Date(t0 + i * step), { precision: 'minute' }));
    return {
      animation: false,
      grid: { left: 36, right: 8, top: 8, bottom: 24 },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { hideOverlap: true, fontSize: 10 },
        axisTick: { show: false },
      },
      yAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { opacity: 0.3 } } },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v) => Number(v).toLocaleString('en-US'),
      },
      series: [
        {
          type: 'bar',
          data,
          barCategoryGap: '20%',
          itemStyle: { color },
        },
      ],
    };
  }

  $effect(() => {
    if (!container) return;
    const instance = echarts.init(container, undefined, { renderer: 'svg' });
    chart = instance;
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => instance.resize());
    observer?.observe(container);
    return () => {
      observer?.disconnect();
      instance.dispose();
      chart = null;
    };
  });

  $effect(() => {
    // Re-render when the clock format or time zone preference changes.
    $displayPreferences;
    if (chart) chart.setOption(buildOption(counts, from, bucketMs));
  });
</script>

<div bind:this={container} class="h-48 w-full" role="img" aria-label="Events over time"></div>
