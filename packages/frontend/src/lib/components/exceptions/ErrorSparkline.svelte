<script lang="ts">
  import * as echarts from 'echarts';
  import { levelTone } from '$lib/utils/severity';

  interface Props {
    counts: number[];
    label: string;
  }

  let { counts, label }: Props = $props();

  let container = $state<HTMLDivElement | null>(null);
  let chart = $state.raw<echarts.ECharts | null>(null);

  const color = levelTone('error').chart;

  function buildOption(data: number[]): echarts.EChartsOption {
    const max = Math.max(1, ...data);
    return {
      animation: false,
      grid: { left: 0, right: 0, top: 2, bottom: 2 },
      xAxis: { type: 'category', show: false, boundaryGap: false, data: data.map((_, i) => i) },
      yAxis: { type: 'value', show: false, min: 0, max },
      tooltip: { show: false },
      series: [
        {
          type: 'line',
          data,
          showSymbol: false,
          silent: true,
          smooth: false,
          lineStyle: { width: 1.5, color },
          itemStyle: { color },
          areaStyle: { color, opacity: 0.15 },
        },
      ],
    };
  }

  $effect(() => {
    if (!container) return;
    const instance = echarts.init(container, undefined, { renderer: 'svg' });
    chart = instance;
    return () => {
      instance.dispose();
      chart = null;
    };
  });

  $effect(() => {
    if (chart) chart.setOption(buildOption(counts));
  });
</script>

<div bind:this={container} class="h-8 w-24" role="img" aria-label={label}></div>
