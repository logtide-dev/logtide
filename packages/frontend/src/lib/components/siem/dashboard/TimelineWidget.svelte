<script lang="ts">
	import { onMount } from 'svelte';
	import * as echarts from 'echarts';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import type { TimelineBucket } from '$lib/api/siem';
	import Activity from '@lucide/svelte/icons/activity';
	import { themeStore } from '$lib/stores/theme';
	import { chartColors, getEChartsTheme, getAxisStyle, getTooltipStyle } from '$lib/utils/echarts-theme';

	interface Props {
		data: TimelineBucket[] | undefined;
		timeRange?: '24h' | '7d' | '30d';
	}

	let { data, timeRange = '24h' }: Props = $props();

	let chartContainer: HTMLDivElement;
	let chart: echarts.ECharts | null = null;

	function formatTimeLabel(timestamp: string): string {
		const date = new Date(timestamp);

		if (timeRange === '24h') {
			return date.toLocaleTimeString('it-IT', {
				hour: '2-digit',
				minute: '2-digit',
				hour12: false,
			});
		} else if (timeRange === '7d') {
			return date.toLocaleDateString('it-IT', {
				weekday: 'short',
				day: 'numeric',
			});
		} else {
			return date.toLocaleDateString('it-IT', {
				month: 'short',
				day: 'numeric',
			});
		}
	}

	function getChartOption(): echarts.EChartsOption {
		const axisStyle = getAxisStyle();
		const tooltipStyle = getTooltipStyle();

		return {
			tooltip: {
				trigger: 'axis',
				formatter: (params: unknown) => {
					const p = params as echarts.DefaultLabelFormatterCallbackParams[];
					if (p && p.length > 0) {
						const date = new Date(data?.[p[0].dataIndex]?.timestamp || '');
						return `${date.toLocaleString('it-IT')}<br/><strong>${p[0].value}</strong> detections`;
					}
					return '';
				},
				...tooltipStyle
			},
			grid: {
				left: '3%',
				right: '4%',
				bottom: '8%',
				top: '8%',
				containLabel: true,
			},
			xAxis: {
				type: 'category',
				boundaryGap: false,
				data: data?.map((d) => formatTimeLabel(d.timestamp)) || [],
				...axisStyle
			},
			yAxis: {
				type: 'value',
				...axisStyle
			},
			series: [
				{
					name: 'Detections',
					type: 'line',
					smooth: true,
					data: data?.map((d) => d.count) || [],
					areaStyle: {
						color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
							{ offset: 0, color: 'rgba(239, 68, 68, 0.4)' },
							{ offset: 1, color: 'rgba(239, 68, 68, 0.05)' },
						]),
					},
					lineStyle: {
						color: chartColors.series.red,
						width: 2,
					},
					itemStyle: {
						color: chartColors.series.red,
					},
					emphasis: {
						focus: 'series',
					},
				},
			],
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
			chart.setOption({
				xAxis: {
					data: data.map((d) => formatTimeLabel(d.timestamp)),
				},
				series: [
					{
						data: data.map((d) => d.count),
					},
				],
			});
		}
	});
</script>

<Card>
	<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
		<CardTitle class="text-sm font-semibold flex items-center gap-2">
			<Activity class="w-4 h-4 text-primary" />
			Detection Timeline
		</CardTitle>
	</CardHeader>
	<CardContent class="pb-3">
		<div bind:this={chartContainer} class="h-[140px] w-full"></div>
	</CardContent>
</Card>
