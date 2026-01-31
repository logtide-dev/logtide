<script lang="ts">
	import type { PreviewSuggestion } from "$lib/api/alerts";
	import Button from "$lib/components/ui/button/button.svelte";
	import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
	import Info from "@lucide/svelte/icons/info";
	import Lightbulb from "@lucide/svelte/icons/lightbulb";

	interface Props {
		suggestions: PreviewSuggestion[];
		onApply?: (suggestion: PreviewSuggestion) => void;
	}

	let { suggestions, onApply }: Props = $props();

	function getSuggestionIcon(type: PreviewSuggestion["type"]) {
		switch (type) {
			case "threshold_too_low":
				return AlertTriangle;
			case "threshold_too_high":
				return Lightbulb;
			case "time_based_pattern":
				return Info;
			case "no_data":
				return Info;
			default:
				return Info;
		}
	}

	function getSuggestionStyle(severity: PreviewSuggestion["severity"]) {
		switch (severity) {
			case "warning":
				return "bg-orange-50 border-orange-200 text-orange-800 dark:bg-orange-950 dark:border-orange-800 dark:text-orange-200";
			case "info":
			default:
				return "bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-200";
		}
	}

	function getIconStyle(severity: PreviewSuggestion["severity"]) {
		switch (severity) {
			case "warning":
				return "text-orange-500 dark:text-orange-400";
			case "info":
			default:
				return "text-blue-500 dark:text-blue-400";
		}
	}
</script>

<div class="space-y-2">
	{#each suggestions as suggestion}
		<div
			class="rounded-lg border p-3 {getSuggestionStyle(suggestion.severity)}"
		>
			<div class="flex items-start gap-2">
				<svelte:component
					this={getSuggestionIcon(suggestion.type)}
					class="w-4 h-4 mt-0.5 flex-shrink-0 {getIconStyle(suggestion.severity)}"
				/>
				<div class="flex-1 min-w-0">
					<p class="text-sm font-medium">{suggestion.message}</p>
					{#if suggestion.detail}
						<p class="text-xs mt-1 opacity-80">{suggestion.detail}</p>
					{/if}
					{#if suggestion.recommendedValue !== undefined && onApply}
						<div class="mt-2 flex items-center gap-2">
							<span class="text-xs">
								Suggested threshold: <strong>{suggestion.recommendedValue}</strong>
							</span>
							<Button
								size="sm"
								variant="outline"
								class="h-6 text-xs px-2"
								onclick={() => onApply(suggestion)}
							>
								Apply
							</Button>
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/each}
</div>
