<script lang="ts">
	import { onMount } from 'svelte';
	import * as echarts from 'echarts';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import type { SeverityDistribution, Severity } from '$lib/api/siem';
	import PieChart from '@lucide/svelte/icons/pie-chart';
	import { themeStore } from '$lib/stores/theme';
	import { chartColors, getTooltipStyle, getLegendStyle } from '$lib/utils/echarts-theme';

	interface Props {
		distribution: SeverityDistribution[] | undefined;
	}

	let { distribution }: Props = $props();

	let chartContainer: HTMLDivElement;
	let chart: echarts.ECharts | null = null;

	function getSeverityColor(severity: Severity): string {
		switch (severity) {
			case 'critical':
				return chartColors.severity.critical;
			case 'high':
				return chartColors.severity.high;
			case 'medium':
				return chartColors.severity.medium;
			case 'low':
				return chartColors.severity.low;
			case 'informational':
				return chartColors.severity.informational;
			default:
				return chartColors.series.gray;
		}
	}

	function getSeverityLabel(severity: Severity): string {
		switch (severity) {
			case 'critical':
				return 'Critical';
			case 'high':
				return 'High';
			case 'medium':
				return 'Medium';
			case 'low':
				return 'Low';
			case 'informational':
				return 'Info';
			default:
				return severity;
		}
	}

	function getChartOption(): echarts.EChartsOption {
		const tooltipStyle = getTooltipStyle();
		const legendStyle = getLegendStyle();

		return {
			tooltip: {
				trigger: 'item',
				formatter: (params: unknown) => {
					const p = params as { name: string; value: number; percent: number };
					return `${p.name}<br/><strong>${p.value}</strong> (${p.percent.toFixed(1)}%)`;
				},
				...tooltipStyle
			},
			legend: {
				orient: 'horizontal',
				bottom: 0,
				textStyle: {
					...legendStyle.textStyle,
					fontSize: 11,
				},
			},
			series: [
				{
					type: 'pie',
					radius: ['40%', '70%'],
					avoidLabelOverlap: false,
					padAngle: 2,
					itemStyle: {
						borderRadius: 4,
					},
					label: {
						show: false,
					},
					emphasis: {
						label: {
							show: true,
							fontSize: 14,
							fontWeight: 'bold',
						},
					},
					data:
						distribution?.map((d) => ({
							name: getSeverityLabel(d.severity),
							value: d.count,
							itemStyle: {
								color: getSeverityColor(d.severity),
							},
						})) || [],
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
		if (chart && distribution) {
			chart.setOption({
				series: [
					{
						data: distribution.map((d) => ({
							name: getSeverityLabel(d.severity),
							value: d.count,
							itemStyle: {
								color: getSeverityColor(d.severity),
							},
						})),
					},
				],
			});
		}
	});
</script>

<Card class="h-full">
	<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
		<CardTitle class="text-base font-semibold flex items-center gap-2">
			<PieChart class="w-4 h-4 text-primary" />
			Severity Distribution
		</CardTitle>
	</CardHeader>
	<CardContent>
		{#if !distribution || distribution.length === 0}
			<div class="text-center py-8 text-muted-foreground">
				<PieChart class="w-8 h-8 mx-auto mb-2 opacity-50" />
				<p class="text-sm">No data available</p>
			</div>
		{:else}
			<div bind:this={chartContainer} class="h-[200px] w-full"></div>
		{/if}
	</CardContent>
</Card>
