<script lang="ts">
	import MousePointerClick from '@lucide/svelte/icons/mouse-pointer-click';
	import Globe from '@lucide/svelte/icons/globe';
	import Terminal from '@lucide/svelte/icons/terminal';
	import Navigation from '@lucide/svelte/icons/navigation';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Layers from '@lucide/svelte/icons/layers';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	interface Breadcrumb {
		type: string;
		category?: string;
		message: string;
		level?: string;
		timestamp: number;
		data?: Record<string, unknown>;
	}

	interface Props {
		breadcrumbs: Breadcrumb[];
		/** Timestamp of the log entry these breadcrumbs belong to */
		eventTime: string;
	}

	let { breadcrumbs, eventTime }: Props = $props();
	let expandedIndex = $state<number | null>(null);

	const eventTimestamp = $derived(new Date(eventTime).getTime());

	function toggleExpanded(index: number) {
		expandedIndex = expandedIndex === index ? null : index;
	}

	function formatRelativeTime(timestamp: number): string {
		const diffMs = eventTimestamp - timestamp;
		if (diffMs < 0) {
			const absDiff = Math.abs(diffMs);
			if (absDiff < 1000) return 'at event';
			return `${formatDuration(absDiff)} after`;
		}
		if (diffMs < 1000) return 'at event';
		return `${formatDuration(diffMs)} before`;
	}

	function formatDuration(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
		return `${(ms / 60_000).toFixed(1)}m`;
	}

	function formatAbsoluteTime(timestamp: number): string {
		return new Date(timestamp).toLocaleTimeString('en-US', {
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			fractionalSecondDigits: 3,
		});
	}

	interface IconConfig {
		icon: typeof Globe;
		color: string;
		bg: string;
	}

	function getTypeConfig(type: string, category?: string): IconConfig {
		if (type === 'ui') {
			return { icon: MousePointerClick, color: 'text-violet-600', bg: 'bg-violet-500/10' };
		}
		if (type === 'http') {
			return { icon: Globe, color: 'text-blue-600', bg: 'bg-blue-500/10' };
		}
		if (type === 'console') {
			return { icon: Terminal, color: 'text-gray-600', bg: 'bg-gray-500/10' };
		}
		if (type === 'navigation') {
			return { icon: Navigation, color: 'text-green-600', bg: 'bg-green-500/10' };
		}
		if (type === 'error') {
			return { icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-500/10' };
		}
		return { icon: Layers, color: 'text-gray-500', bg: 'bg-gray-500/10' };
	}

	function getLevelColor(level?: string): string {
		switch (level) {
			case 'error':
				return 'border-l-red-400';
			case 'warn':
				return 'border-l-yellow-400';
			case 'debug':
				return 'border-l-gray-300';
			default:
				return 'border-l-blue-300';
		}
	}
</script>

{#if breadcrumbs.length > 0}
	<div class="relative">
		<!-- Timeline line -->
		<div
			class="absolute left-3.5 top-0 bottom-0 w-px bg-border"
		></div>

		<div class="space-y-1">
			{#each breadcrumbs as crumb, i}
				{@const config = getTypeConfig(crumb.type, crumb.category)}
				{@const hasData = crumb.data && Object.keys(crumb.data).length > 0}

				<div
					class="relative flex items-start gap-3 pl-8 border-l-2 {getLevelColor(crumb.level)} ml-[13px] py-1.5 pr-2"
				>
					<!-- Icon -->
					<div
						class="absolute left-0 w-7 h-7 rounded-full flex items-center justify-center {config.bg} -translate-x-[calc(50%+1px)]"
					>
						<config.icon class="w-3.5 h-3.5 {config.color}" />
					</div>

					<!-- Content -->
					<div class="flex-1 min-w-0">
						<button
							type="button"
							class="w-full text-left group"
							onclick={() => hasData && toggleExpanded(i)}
							disabled={!hasData}
						>
							<div class="flex items-center gap-2">
								<span
									class="text-xs font-mono text-muted-foreground shrink-0"
									title={formatAbsoluteTime(crumb.timestamp)}
								>
									{formatRelativeTime(crumb.timestamp)}
								</span>
								{#if crumb.category}
									<span class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70 shrink-0">
										{crumb.category}
									</span>
								{/if}
							</div>
							<div class="flex items-center gap-1 mt-0.5">
								{#if hasData}
									{#if expandedIndex === i}
										<ChevronDown class="w-3 h-3 text-muted-foreground shrink-0" />
									{:else}
										<ChevronRight class="w-3 h-3 text-muted-foreground shrink-0" />
									{/if}
								{/if}
								<span class="text-xs truncate" title={crumb.message}>
									{crumb.message}
								</span>
							</div>
						</button>

						{#if hasData && expandedIndex === i}
							<pre class="mt-1.5 p-2 bg-muted rounded text-[11px] overflow-x-auto max-w-full">{JSON.stringify(crumb.data, null, 2)}</pre>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
{:else}
	<div class="text-center py-4 text-muted-foreground text-xs">
		No breadcrumbs recorded
	</div>
{/if}
