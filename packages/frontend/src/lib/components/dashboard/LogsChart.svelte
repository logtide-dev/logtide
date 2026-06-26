<script lang="ts">
  import { onMount } from 'svelte';
  import * as echarts from 'echarts';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { themeStore } from '$lib/stores/theme';
  import { chartColors, getEChartsTheme, getAxisStyle, getTooltipStyle, getLegendStyle } from '$lib/utils/echarts-theme';

  import type { TimelineEvent } from '$lib/api/dashboard';

  interface ChartClickParams {
    seriesName: string;
    time: string;
    value: number;
  }

  interface Props {
    data: {
      time: string;
      total: number;
      error: number;
      warn: number;
      info: number;
    }[];
    events?: TimelineEvent[];
    onDataPointClick?: (params: ChartClickParams) => void;
  }

  let { data, events = [], onDataPointClick }: Props = $props();
  let chartContainer: HTMLDivElement;
  let chart: echarts.ECharts | null = null;

  function formatTimeLabel(time: string): string {
    return new Date(time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function buildEventSeries(): echarts.SeriesOption[] {
    if (!events || events.length === 0) return [];

    // Build a map of formatted time label -> data index for matching
    const timeLabels = data.map(d => formatTimeLabel(d.time));
    const labelToIndex = new Map<string, number>();
    timeLabels.forEach((label, i) => { labelToIndex.set(label, i); });

    // Build scatter data: [xIndex, yValue, eventData]
    const scatterData: any[] = [];

    for (const event of events) {
      const label = formatTimeLabel(event.time);
      const idx = labelToIndex.get(label);
      if (idx === undefined) continue;

      const yValue = data[idx].total;
      const hasAlerts = event.alerts > 0;
      const hasDetections = event.detections > 0;

      scatterData.push({
        value: [idx, yValue],
        event,
        itemStyle: {
          color: hasAlerts ? chartColors.series.red : chartColors.series.purple,
          borderColor: '#fff',
          borderWidth: 2,
          shadowBlur: 4,
          shadowColor: hasAlerts ? 'rgba(239, 68, 68, 0.4)' : 'rgba(168, 85, 247, 0.4)',
        },
        symbolSize: hasAlerts && hasDetections ? 16 : 12,
      });
    }

    if (scatterData.length === 0) return [];

    return [{
      name: 'Events',
      type: 'scatter',
      data: scatterData,
      symbol: 'circle',
      z: 10,
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          const ev = params.data.event as TimelineEvent;
          const parts: string[] = [];

          if (ev.alerts > 0) {
            parts.push(`<b style="color:${chartColors.series.red}">Alerts: ${ev.alerts}</b>`);
            for (const detail of ev.alertDetails.slice(0, 3)) {
              parts.push(`&nbsp;&nbsp;• ${detail.ruleName} (${detail.logCount} logs)`);
            }
            if (ev.alertDetails.length > 3) {
              parts.push(`&nbsp;&nbsp;...and ${ev.alertDetails.length - 3} more`);
            }
          }

          if (ev.detections > 0) {
            parts.push(`<b style="color:${chartColors.series.purple}">Detections: ${ev.detections}</b>`);
            const sev = ev.detectionsBySeverity;
            const sevParts: string[] = [];
            if (sev.critical > 0) sevParts.push(`${sev.critical} critical`);
            if (sev.high > 0) sevParts.push(`${sev.high} high`);
            if (sev.medium > 0) sevParts.push(`${sev.medium} medium`);
            if (sev.low > 0) sevParts.push(`${sev.low} low`);
            if (sevParts.length > 0) {
              parts.push(`&nbsp;&nbsp;${sevParts.join(', ')}`);
            }
          }

          return parts.join('<br/>');
        },
      },
    }];
  }

  function getChartOption(): echarts.EChartsOption {
    const axisStyle = getAxisStyle();
    const tooltipStyle = getTooltipStyle();
    const legendStyle = getLegendStyle();
    const eventSeries = buildEventSeries();
    const hasEvents = eventSeries.length > 0;

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross'
        },
        ...tooltipStyle
      },
      legend: {
        data: hasEvents ? ['Total', 'Errors', 'Warnings', 'Info', 'Events'] : ['Total', 'Errors', 'Warnings', 'Info'],
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
        data: data.map(d => formatTimeLabel(d.time)),
        ...axisStyle
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        ...axisStyle,
        axisLabel: {
          ...axisStyle.axisLabel,
          formatter: (value: number) => {
            if (value % 1 !== 0) return '';
            return value.toLocaleString('en-US');
          }
        }
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
        },
        ...eventSeries,
      ]
    };
  }

  onMount(() => {
    chart = echarts.init(chartContainer);
    chart.setOption(getChartOption());

    // Handle click events on chart data points
    chart.on('click', (params: any) => {
      if (params.componentType === 'series' && onDataPointClick && data[params.dataIndex]) {
        onDataPointClick({
          seriesName: params.seriesName,
          time: data[params.dataIndex].time,
          value: params.value
        });
      }
    });

    const resizeObserver = new ResizeObserver(() => chart?.resize());
    resizeObserver.observe(chartContainer);

    // Subscribe to theme changes
    const unsubscribe = themeStore.subscribe(() => {
      if (chart) {
        chart.setOption(getChartOption());
      }
    });

    return () => {
      resizeObserver.disconnect();
      unsubscribe();
      chart?.off('click');
      chart?.dispose();
    };
  });

  $effect(() => {
    if (chart && data) {
      // Rebuild full option when data or events change
      // (need full rebuild because event scatter series depends on both data and events)
      void events;
      chart.setOption(getChartOption(), true);
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
