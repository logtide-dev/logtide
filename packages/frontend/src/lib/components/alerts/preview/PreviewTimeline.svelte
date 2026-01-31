<script lang="ts">
	import type { PreviewIncident } from "$lib/api/alerts";
	import { onMount } from "svelte";
	import * as echarts from "echarts";
	import { themeStore } from "$lib/stores/theme";
	import {
		getAxisStyle,
		getTooltipStyle,
		chartColors,
	} from "$lib/utils/echarts-theme";

	interface Props {
		incidents: PreviewIncident[];
		threshold: number;
		timeRange: {
			from: string;
			to: string;
		};
	}

	let { incidents, threshold, timeRange }: Props = $props();

	let chartContainer: HTMLDivElement;
	let chart: echarts.ECharts | null = null;
	let cleanup: (() => void) | undefined;

	function getChartOption(): echarts.EChartsOption {
		const axisStyle = getAxisStyle();
		const tooltipStyle = getTooltipStyle();

		// Generate data points from incidents
		const dataPoints: Array<{ time: Date; value: number; incident: PreviewIncident | null }> = [];

		// Add start point
		dataPoints.push({
			time: new Date(timeRange.from),
			value: 0,
			incident: null,
		});

		// Add incident points
		for (const incident of incidents) {
			// Point just before incident
			dataPoints.push({
				time: new Date(new Date(incident.startTime).getTime() - 60000),
				value: 0,
				incident: null,
			});
			// Start of incident (peak)
			dataPoints.push({
				time: new Date(incident.startTime),
				value: incident.peakValue,
				incident,
			});
			// End of incident
			dataPoints.push({
				time: new Date(incident.endTime),
				value: incident.averageValue,
				incident,
			});
			// Point just after incident
			dataPoints.push({
				time: new Date(new Date(incident.endTime).getTime() + 60000),
				value: 0,
				incident: null,
			});
		}

		// Add end point
		dataPoints.push({
			time: new Date(timeRange.to),
			value: 0,
			incident: null,
		});

		// Sort by time
		dataPoints.sort((a, b) => a.time.getTime() - b.time.getTime());

		// Format times for x-axis
		const times = dataPoints.map((d) =>
			d.time.toLocaleString("en-US", {
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
				hour12: false,
			})
		);

		const values = dataPoints.map((d) => d.value);

		return {
			tooltip: {
				trigger: "axis",
				axisPointer: { type: "cross" },
				...tooltipStyle,
				formatter: (params: any) => {
					const p = params[0];
					if (!p) return "";
					const point = dataPoints[p.dataIndex];
					if (!point) return "";

					if (point.incident) {
						return `
							<div class="font-semibold">${p.axisValue}</div>
							<div class="text-sm">
								Peak: <strong>${point.incident.peakValue}</strong> logs<br/>
								Duration: ${point.incident.durationMinutes} min<br/>
								<span class="text-red-500">Alert would have triggered</span>
							</div>
						`;
					}
					return `<div class="text-sm">${p.axisValue}</div>`;
				},
			},
			grid: {
				left: "3%",
				right: "4%",
				bottom: "15%",
				top: "10%",
				containLabel: true,
			},
			xAxis: {
				type: "category",
				data: times,
				...axisStyle,
				axisLabel: {
					...axisStyle.axisLabel,
					rotate: 45,
					fontSize: 10,
				},
			},
			yAxis: {
				type: "value",
				name: "Log Count",
				...axisStyle,
			},
			series: [
				{
					name: "Log Count",
					type: "line",
					data: values,
					smooth: false,
					lineStyle: { color: chartColors.series.blue, width: 2 },
					itemStyle: { color: chartColors.series.blue },
					areaStyle: {
						color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
							{ offset: 0, color: "rgba(59, 130, 246, 0.3)" },
							{ offset: 1, color: "rgba(59, 130, 246, 0.05)" },
						]),
					},
					markLine: {
						silent: true,
						symbol: "none",
						lineStyle: {
							color: chartColors.series.red,
							type: "dashed",
							width: 2,
						},
						data: [
							{
								yAxis: threshold,
								label: {
									formatter: `Threshold: ${threshold}`,
									position: "end",
								},
							},
						],
					},
				},
			],
		};
	}

	function initChart() {
		if (!chartContainer) return;

		chart = echarts.init(chartContainer);
		chart.setOption(getChartOption());

		const handleResize = () => chart?.resize();
		window.addEventListener("resize", handleResize);

		return () => {
			window.removeEventListener("resize", handleResize);
			chart?.dispose();
		};
	}

	onMount(() => {
		cleanup = initChart();
		return () => cleanup?.();
	});

	// Update chart when data or theme changes
	$effect(() => {
		if (chart && incidents) {
			chart.setOption(getChartOption());
		}
	});

	// Re-init on theme change
	$effect(() => {
		$themeStore;
		if (chart) {
			cleanup?.();
			chart.dispose();
			cleanup = initChart();
		}
	});
</script>

<div class="w-full">
	{#if incidents.length === 0}
		<div class="text-center py-8 text-muted-foreground text-sm">
			No incidents to display in the timeline.
		</div>
	{:else}
		<div
			bind:this={chartContainer}
			class="h-[200px] md:h-[250px] w-full"
		></div>
		<p class="text-xs text-center text-muted-foreground mt-2">
			{incidents.length} incident{incidents.length !== 1 ? "s" : ""} detected
			- dashed line shows threshold ({threshold} logs)
		</p>
	{/if}
</div>
