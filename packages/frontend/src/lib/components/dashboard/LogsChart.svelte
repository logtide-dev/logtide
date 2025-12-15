<script lang="ts">
  import { onMount } from 'svelte';
  import * as echarts from 'echarts';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { themeStore } from '$lib/stores/theme';
  import { chartColors, getEChartsTheme, getAxisStyle, getTooltipStyle, getLegendStyle } from '$lib/utils/echarts-theme';

  interface Props {
    data: {
      time: string;
      total: number;
      error: number;
      warn: number;
      info: number;
    }[];
  }

  let { data }: Props = $props();
  let chartContainer: HTMLDivElement;
  let chart: echarts.ECharts | null = null;

  function getChartOption(): echarts.EChartsOption {
    const axisStyle = getAxisStyle();
    const tooltipStyle = getTooltipStyle();
    const legendStyle = getLegendStyle();

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross'
        },
        ...tooltipStyle
      },
      legend: {
        data: ['Total', 'Errors', 'Warnings', 'Info'],
        bottom: 0,
        ...legendStyle
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '10%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: data.map(d => new Date(d.time).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false })),
        ...axisStyle
      },
      yAxis: {
        type: 'value',
        ...axisStyle
      },
      series: [
        {
          name: 'Total',
          type: 'line',
          smooth: true,
          data: data.map(d => d.total),
          lineStyle: { color: chartColors.series.blue },
          itemStyle: { color: chartColors.series.blue }
        },
        {
          name: 'Errors',
          type: 'line',
          smooth: true,
          data: data.map(d => d.error),
          lineStyle: { color: chartColors.series.red },
          itemStyle: { color: chartColors.series.red }
        },
        {
          name: 'Warnings',
          type: 'line',
          smooth: true,
          data: data.map(d => d.warn),
          lineStyle: { color: chartColors.series.amber },
          itemStyle: { color: chartColors.series.amber }
        },
        {
          name: 'Info',
          type: 'line',
          smooth: true,
          data: data.map(d => d.info),
          lineStyle: { color: chartColors.series.green },
          itemStyle: { color: chartColors.series.green }
        }
      ]
    };
  }

  onMount(() => {
    chart = echarts.init(chartContainer);
    chart.setOption(getChartOption());

    const handleResize = () => chart?.resize();
    window.addEventListener('resize', handleResize);

    // Subscribe to theme changes
    const unsubscribe = themeStore.subscribe(() => {
      if (chart) {
        chart.setOption(getChartOption());
      }
    });

    return () => {
      window.removeEventListener('resize', handleResize);
      unsubscribe();
      chart?.dispose();
    };
  });

  $effect(() => {
    if (chart && data) {
      // Update data only (theme changes are handled by subscription)
      chart.setOption({
        xAxis: {
          data: data.map(d => new Date(d.time).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false }))
        },
        series: [
          { data: data.map(d => d.total) },
          { data: data.map(d => d.error) },
          { data: data.map(d => d.warn) },
          { data: data.map(d => d.info) }
        ]
      });
    }
  });
</script>

<Card>
  <CardHeader>
    <CardTitle>Logs Timeline (Last 24 Hours)</CardTitle>
  </CardHeader>
  <CardContent>
    <div bind:this={chartContainer} class="h-[300px] w-full"></div>
  </CardContent>
</Card>
