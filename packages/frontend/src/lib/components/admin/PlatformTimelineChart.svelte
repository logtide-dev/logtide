<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { browser } from '$app/environment';
    import * as echarts from 'echarts';
    import { chartColors, getAxisStyle, getTooltipStyle, getLegendStyle, getEChartsTheme } from '$lib/utils/echarts-theme';
    import { themeStore } from '$lib/stores/theme';
    import type { PlatformTimeline } from '$lib/api/admin';

    let { data }: { data: PlatformTimeline | null } = $props();

    let chartContainer: HTMLDivElement;
    let chart: echarts.ECharts | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let unsubTheme: (() => void) | null = null;

    function getChartOption() {
        const theme = getEChartsTheme();
        const axisStyle = getAxisStyle();
        const tooltipStyle = getTooltipStyle();
        const legendStyle = getLegendStyle();

        const timeline = data?.timeline || [];
        const buckets = timeline.map(t => {
            const d = new Date(t.bucket);
            return `${d.getHours().toString().padStart(2, '0')}:00`;
        });

        return {
            tooltip: {
                trigger: 'axis',
                ...tooltipStyle,
                formatter: (params: any) => {
                    if (!Array.isArray(params) || params.length === 0) return '';
                    const idx = params[0].dataIndex;
                    const item = timeline[idx];
                    if (!item) return '';
                    const d = new Date(item.bucket);
                    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                    let html = `<div style="font-weight:600;margin-bottom:4px">${dateStr} ${timeStr}</div>`;
                    for (const p of params) {
                        html += `<div style="display:flex;justify-content:space-between;gap:16px">`;
                        html += `<span>${p.marker} ${p.seriesName}</span>`;
                        html += `<span style="font-weight:600">${Number(p.value).toLocaleString('en-US')}</span>`;
                        html += `</div>`;
                    }
                    return html;
                },
            },
            legend: {
                ...legendStyle,
                bottom: 0,
                data: ['Logs', 'Detections', 'Spans', 'Metrics'],
            },
            grid: {
                left: '3%',
                right: '4%',
                top: '8%',
                bottom: '15%',
                containLabel: true,
            },
            xAxis: {
                type: 'category',
                boundaryGap: false,
                data: buckets,
                ...axisStyle,
            },
            yAxis: {
                type: 'value',
                minInterval: 1,
                ...axisStyle,
                axisLabel: {
                    ...axisStyle.axisLabel,
                    formatter: (val: number) => {
                        if (val % 1 !== 0) return '';
                        if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
                        if (val >= 1000) return `${(val / 1000).toFixed(0)}k`;
                        return val.toLocaleString('en-US');
                    },
                },
            },
            series: [
                {
                    name: 'Logs',
                    type: 'line',
                    smooth: true,
                    data: timeline.map(t => t.logsCount),
                    lineStyle: { color: chartColors.series.blue, width: 2 },
                    itemStyle: { color: chartColors.series.blue },
                    areaStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: theme.isDark ? 'rgba(59,130,246,0.25)' : 'rgba(59,130,246,0.15)' },
                            { offset: 1, color: 'rgba(59,130,246,0)' },
                        ]),
                    },
                    symbol: 'none',
                },
                {
                    name: 'Detections',
                    type: 'line',
                    smooth: true,
                    data: timeline.map(t => t.detectionsCount),
                    lineStyle: { color: chartColors.series.orange, width: 2 },
                    itemStyle: { color: chartColors.series.orange },
                    areaStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: theme.isDark ? 'rgba(249,115,22,0.2)' : 'rgba(249,115,22,0.1)' },
                            { offset: 1, color: 'rgba(249,115,22,0)' },
                        ]),
                    },
                    symbol: 'none',
                },
                {
                    name: 'Spans',
                    type: 'line',
                    smooth: true,
                    data: timeline.map(t => t.spansCount),
                    lineStyle: { color: chartColors.series.purple, width: 2, type: 'dashed' },
                    itemStyle: { color: chartColors.series.purple },
                    symbol: 'none',
                },
                {
                    name: 'Metrics',
                    type: 'line',
                    smooth: true,
                    data: timeline.map(t => t.metricsCount),
                    lineStyle: { color: chartColors.series.green, width: 2 },
                    itemStyle: { color: chartColors.series.green },
                    areaStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: theme.isDark ? 'rgba(34,197,94,0.2)' : 'rgba(34,197,94,0.1)' },
                            { offset: 1, color: 'rgba(34,197,94,0)' },
                        ]),
                    },
                    symbol: 'none',
                },
            ],
        };
    }

    function updateChart() {
        if (!chart) return;
        chart.setOption(getChartOption(), true);
    }

    onMount(() => {
        if (!browser || !chartContainer) return;

        chart = echarts.init(chartContainer);
        chart.setOption(getChartOption());

        resizeObserver = new ResizeObserver(() => {
            chart?.resize();
        });
        resizeObserver.observe(chartContainer);

        unsubTheme = themeStore.subscribe(() => {
            updateChart();
        });
    });

    onDestroy(() => {
        resizeObserver?.disconnect();
        unsubTheme?.();
        chart?.dispose();
    });

    $effect(() => {
        if (data && chart) {
            updateChart();
        }
    });
</script>

<div bind:this={chartContainer} class="w-full h-[280px]"></div>
