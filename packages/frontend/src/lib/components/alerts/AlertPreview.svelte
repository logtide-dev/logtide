<script lang="ts">
	import {
		alertsAPI,
		type PreviewAlertRuleOutput,
		type PreviewRange,
		type PreviewSuggestion,
	} from "$lib/api/alerts";
	import { toastStore } from "$lib/stores/toast";
	import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
	import Button from "$lib/components/ui/button/button.svelte";
	import {
		Tabs,
		TabsContent,
		TabsList,
		TabsTrigger,
	} from "$lib/components/ui/tabs";
	import Spinner from "$lib/components/Spinner.svelte";
	import X from "@lucide/svelte/icons/x";
	import AlertCircle from "@lucide/svelte/icons/alert-circle";
	import RefreshCw from "@lucide/svelte/icons/refresh-cw";
	import PreviewSummary from "./preview/PreviewSummary.svelte";
	import PreviewTimeline from "./preview/PreviewTimeline.svelte";
	import PreviewSamples from "./preview/PreviewSamples.svelte";
	import PreviewStatistics from "./preview/PreviewStatistics.svelte";
	import PreviewSuggestions from "./preview/PreviewSuggestions.svelte";

	interface Props {
		organizationId: string;
		projectId?: string | null;
		service?: string | null;
		levels: ("debug" | "info" | "warn" | "error" | "critical")[];
		threshold: number;
		timeWindow: number;
		visible: boolean;
		onClose?: () => void;
		onSuggestionApply?: (suggestion: PreviewSuggestion) => void;
	}

	let {
		organizationId,
		projectId = null,
		service = null,
		levels,
		threshold,
		timeWindow,
		visible = $bindable(),
		onClose,
		onSuggestionApply,
	}: Props = $props();

	let loading = $state(true);
	let error = $state<string | null>(null);
	let data = $state<PreviewAlertRuleOutput | null>(null);
	let timeRange = $state<PreviewRange>("7d");
	let currentTab = $state<"timeline" | "samples" | "statistics">("timeline");

	const timeRangeOptions: PreviewRange[] = ["1d", "7d", "14d", "30d"];

	async function loadPreview() {
		loading = true;
		error = null;

		try {
			const response = await alertsAPI.previewAlertRule({
				organizationId,
				projectId,
				service,
				level: levels,
				threshold,
				timeWindow,
				previewRange: timeRange,
			});

			data = response.preview;
		} catch (e) {
			error = e instanceof Error ? e.message : "Failed to load preview";
			toastStore.error(error);
		} finally {
			loading = false;
		}
	}

	function handleTimeRangeChange(range: PreviewRange) {
		timeRange = range;
		loadPreview();
	}

	function handleSuggestionApply(suggestion: PreviewSuggestion) {
		onSuggestionApply?.(suggestion);
		visible = false;
	}

	function handleClose() {
		visible = false;
		onClose?.();
	}

	$effect(() => {
		if (visible) {
			loadPreview();
		}
	});
</script>

{#if visible}
	<Card class="bg-muted/30 border-primary/20">
		<CardHeader class="flex flex-row items-center justify-between py-3">
			<CardTitle class="text-base font-medium">Alert Preview</CardTitle>
			<div class="flex gap-2 items-center">
				<!-- Time Range Selector -->
				<div class="flex gap-1">
					{#each timeRangeOptions as range}
						<Button
							size="sm"
							variant={timeRange === range ? "default" : "outline"}
							onclick={() => handleTimeRangeChange(range)}
							disabled={loading}
							class="h-7 px-2 text-xs"
						>
							{range}
						</Button>
					{/each}
				</div>
				<Button
					size="icon"
					variant="ghost"
					onclick={() => loadPreview()}
					disabled={loading}
					class="h-7 w-7"
				>
					<RefreshCw class="h-3.5 w-3.5 {loading ? 'animate-spin' : ''}" />
				</Button>
				<Button
					size="icon"
					variant="ghost"
					onclick={handleClose}
					class="h-7 w-7"
				>
					<X class="h-3.5 w-3.5" />
				</Button>
			</div>
		</CardHeader>

		<CardContent class="pt-0">
			{#if loading}
				<div class="flex justify-center items-center py-8">
					<Spinner />
					<span class="ml-3 text-sm text-muted-foreground"
						>Analyzing historical logs...</span
					>
				</div>
			{:else if error}
				<div class="text-center py-6">
					<AlertCircle
						class="h-10 w-10 mx-auto mb-2 text-destructive"
					/>
					<p class="text-sm text-destructive">{error}</p>
					<Button
						size="sm"
						variant="outline"
						onclick={() => loadPreview()}
						class="mt-3"
					>
						Retry
					</Button>
				</div>
			{:else if data}
				<!-- Summary (Always Visible) -->
				<PreviewSummary
					totalTriggers={data.summary.totalTriggers}
					totalIncidents={data.summary.totalIncidents}
					{timeRange}
					avgDuration={data.statistics.incidents.averageDuration}
					affectedServices={data.summary.affectedServices}
				/>

				<!-- Suggestions (If Any) -->
				{#if data.suggestions.length > 0}
					<div class="mt-4">
						<PreviewSuggestions
							suggestions={data.suggestions}
							onApply={handleSuggestionApply}
						/>
					</div>
				{/if}

				<!-- Detailed Tabs -->
				{#if data.summary.totalIncidents > 0 || data.statistics.thresholdAnalysis.p99Value > 0}
					<Tabs
						value={currentTab}
						onValueChange={(v) => (currentTab = v as typeof currentTab)}
						class="mt-4"
					>
						<TabsList class="grid w-full grid-cols-3 h-8">
							<TabsTrigger value="timeline" class="text-xs"
								>Timeline</TabsTrigger
							>
							<TabsTrigger value="samples" class="text-xs"
								>Sample Incidents</TabsTrigger
							>
							<TabsTrigger value="statistics" class="text-xs"
								>Statistics</TabsTrigger
							>
						</TabsList>

						<TabsContent value="timeline" class="mt-3">
							<PreviewTimeline
								incidents={data.incidents}
								{threshold}
								timeRange={data.summary.timeRange}
							/>
						</TabsContent>

						<TabsContent value="samples" class="mt-3">
							<PreviewSamples incidents={data.incidents} />
						</TabsContent>

						<TabsContent value="statistics" class="mt-3">
							<PreviewStatistics
								byDayOfWeek={data.statistics.temporalPatterns
									.byDayOfWeek}
								byHourOfDay={data.statistics.temporalPatterns
									.byHourOfDay}
								thresholdAnalysis={data.statistics
									.thresholdAnalysis}
								incidentStats={data.statistics.incidents}
							/>
						</TabsContent>
					</Tabs>
				{/if}
			{/if}
		</CardContent>
	</Card>
{/if}
