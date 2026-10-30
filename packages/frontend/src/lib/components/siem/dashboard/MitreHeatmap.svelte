<script lang="ts">
	import * as echarts from 'echarts';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import type { MitreHeatmapCell } from '$lib/api/siem';
	import Grid3x3 from '@lucide/svelte/icons/grid-3x3';
	import { getTacticName, getTechniqueName } from '@logtide/shared';
	import { themeStore } from '$lib/stores/theme';
	import { getEChartsTheme, getTooltipStyle } from '$lib/utils/echarts-theme';
	import { severityTone } from '$lib/utils/severity';

	interface Props {
		cells: MitreHeatmapCell[] | undefined;
		onCellClick?: (cell: MitreHeatmapCell) => void;
	}

	let { cells, onCellClick }: Props = $props();

	let chartContainer = $state<HTMLDivElement | null>(null);
	let chart: echarts.ECharts | null = null;

	// MITRE ATT&CK tactic abbreviations (for compact display)
	const tacticAbbreviations: Record<string, string> = {
		reconnaissance: 'Recon',
		resource_development: 'Res Dev',
		initial_access: 'Init Access',
		execution: 'Exec',
		persistence: 'Persist',
		privilege_escalation: 'Priv Esc',
		defense_evasion: 'Def Eva',
		credential_access: 'Cred',
		discovery: 'Disc',
		lateral_movement: 'Lat Mov',
		collection: 'Coll',
		command_and_control: 'C2',
		exfiltration: 'Exfil',
		impact: 'Impact',
	};

	function abbreviateTactic(tactic: string): string {
		const lower = tactic.toLowerCase().replace(/-/g, '_');
		return tacticAbbreviations[lower] || getTacticName(tactic).slice(0, 8);
	}

	function abbreviateTechnique(technique: string): string {
		// Get human-readable name from MITRE mapping
		const name = getTechniqueName(technique);
		// If we have a human-readable name (not just the ID), use it
		if (name !== technique) {
			// Truncate long names
			return name.length > 12 ? name.slice(0, 10) + '..' : name;
		}
		// Fallback to technique ID
		if (technique.match(/^T\d{4}/i)) {
			return technique.split('.')[0].toUpperCase();
		}
		return technique.slice(0, 8);
	}

	function getFullTechniqueName(technique: string): string {
		const name = getTechniqueName(technique);
		if (name !== technique) {
			return `${technique}: ${name}`;
		}
		return technique;
	}

	const summary = $derived.by(() => {
		if (!cells || cells.length === 0) return 'No MITRE data available';
		const total = cells.reduce((sum, c) => sum + c.count, 0);
		return `MITRE ATT&CK heatmap, ${total.toLocaleString('en-US')} detections across ${cells.length.toLocaleString('en-US')} technique and tactic pairs`;
	});

	// Initialize the chart once the container element is available. The container
	// is always rendered (the empty state is an overlay), so this runs even when
	// data arrives after mount.
	$effect(() => {
		if (!chartContainer || chart) return;

		chart = echarts.init(chartContainer);
		updateChart();

		const resizeObserver = new ResizeObserver(() => chart?.resize());
		resizeObserver.observe(chartContainer);

		// Subscribe to theme changes
		const unsubscribe = themeStore.subscribe(() => {
			if (chart) {
				updateChart();
			}
		});

		return () => {
			resizeObserver.disconnect();
			unsubscribe();
			chart?.dispose();
			chart = null;
		};
	});

	function updateChart() {
		if (!chart || !cells || cells.length === 0) return;

		const theme = getEChartsTheme();
		const tooltipStyle = getTooltipStyle();

		// Drop cells with null/empty tactic or technique to avoid downstream crashes
		const validCells = cells.filter((c) => c.tactic && c.technique);
		if (validCells.length === 0) return;

		// Extract unique tactics and techniques
		const tactics = [...new Set(validCells.map((c) => c.tactic))].sort();
		const techniques = [...new Set(validCells.map((c) => c.technique))].sort();

		// Limit to top 10 techniques if more
		const topTechniques = techniques.slice(0, 10);

		// Build data matrix
		const data: [number, number, number][] = [];
		const maxCount = Math.max(...validCells.map((c) => c.count), 1);

		topTechniques.forEach((technique, techIndex) => {
			tactics.forEach((tactic, tacticIndex) => {
				const cell = validCells.find((c) => c.technique === technique && c.tactic === tactic);
				if (cell) {
					data.push([tacticIndex, techIndex, cell.count]);
				}
			});
		});

		// Intensity runs from a theme-aware base through the severity colours
		const gradientColors = [
			theme.isDark ? '#0f172a' : '#e0f2fe',
			severityTone('informational').chart,
			severityTone('high').chart,
			severityTone('critical').chart,
		];

		const option: echarts.EChartsOption = {
			tooltip: {
				position: 'top',
				formatter: (params: unknown) => {
					const p = params as { data: [number, number, number] };
					const tacticId = tactics[p.data[0]];
					const techniqueId = topTechniques[p.data[1]];
					const count = p.data[2];
					const tacticFullName = getTacticName(tacticId);
					const techniqueFullName = getFullTechniqueName(techniqueId);
					return `<strong>${techniqueFullName}</strong><br/>Tactic: ${tacticFullName}<br/>${count} detection${count !== 1 ? 's' : ''}`;
				},
				...tooltipStyle
			},
			grid: {
				left: '15%',
				right: '10%',
				top: '5%',
				bottom: '30%',
			},
			xAxis: {
				type: 'category',
				data: tactics.map(abbreviateTactic),
				splitArea: { show: true },
				axisLabel: {
                    show: false,
				},

			},
			yAxis: {
				type: 'category',
				data: topTechniques.map(abbreviateTechnique),
				splitArea: { show: true },
				axisLabel: {
					fontSize: 9,
					color: theme.textColor,
				},
			},
			visualMap: {
				min: 0,
				max: maxCount,
				calculable: true,
				orient: 'horizontal',
				left: 'center',
				bottom: '3%',
				inRange: {
					color: gradientColors,
				},
				textStyle: {
					color: theme.textColor,
					fontSize: 10,
				},
			},
			series: [
				{
					type: 'heatmap',
					data: data,
					label: {
						show: true,
						formatter: (params: unknown) => {
							const p = params as { data: [number, number, number] };
							return p.data[2] > 0 ? p.data[2].toString() : '';
						},
						fontSize: 9,
					},
					emphasis: {
						itemStyle: {
							shadowBlur: 10,
							shadowColor: 'rgba(0, 0, 0, 0.5)',
						},
					},
				},
			],
		};

		chart.setOption(option);

		// Handle cell click
		chart.off('click');
		chart.on('click', (params) => {
			if (params.componentType === 'series' && params.data) {
				const [tacticIndex, techIndex] = params.data as [number, number, number];
				const cell = cells.find(
					(c) => c.tactic === tactics[tacticIndex] && c.technique === topTechniques[techIndex]
				);
				if (cell && onCellClick) {
					onCellClick(cell);
				}
			}
		});
	}

	$effect(() => {
		if (chart && cells) {
			updateChart();
		}
	});
</script>

<Card class="h-full">
	<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
		<CardTitle class="text-base font-semibold flex items-center gap-2">
			<Grid3x3 class="w-4 h-4 text-primary" />
			MITRE ATT&CK heatmap
		</CardTitle>
	</CardHeader>
	<CardContent>
		<div class="relative h-[280px] w-full">
			<div bind:this={chartContainer} role="img" aria-label={summary} class="h-full w-full"></div>
			{#if !cells || cells.length === 0}
				<div
					class="absolute inset-0 flex flex-col items-center justify-center text-center text-muted-foreground"
				>
					<Grid3x3 class="w-8 h-8 mx-auto mb-2 opacity-50" />
					<p class="text-sm">No MITRE data available</p>
				</div>
			{/if}
		</div>
	</CardContent>
</Card>
