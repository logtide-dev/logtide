<script lang="ts">
	import { Card, CardContent } from '$lib/components/ui/card';
	import LanguageBadge from './shared/LanguageBadge.svelte';
	import ErrorGroupStatusBadge from './shared/ErrorGroupStatusBadge.svelte';
	import type { ErrorGroup } from '$lib/api/exceptions';
	import Clock from '@lucide/svelte/icons/clock';
	import Hash from '@lucide/svelte/icons/hash';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	interface Props {
		group: ErrorGroup;
		onclick?: () => void;
	}

	let { group, onclick }: Props = $props();

	function formatDate(dateStr: string): string {
		const date = new Date(dateStr);
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	}

	function formatTimeAgo(dateStr: string): string {
		const date = new Date(dateStr);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 60) {
			return `${diffMins}m ago`;
		} else if (diffHours < 24) {
			return `${diffHours}h ago`;
		} else {
			return `${diffDays}d ago`;
		}
	}

	function formatOccurrences(count: number): string {
		if (count >= 1000000) {
			return `${(count / 1000000).toFixed(1)}M`;
		} else if (count >= 1000) {
			return `${(count / 1000).toFixed(1)}K`;
		}
		return count.toString();
	}
</script>

<Card
	class="cursor-pointer hover:bg-accent/50 transition-colors border-l-4 {group.status === 'open'
		? 'border-l-red-500'
		: group.status === 'resolved'
			? 'border-l-green-500'
			: 'border-l-gray-400'}"
	role="button"
	tabindex="0"
	onclick={onclick}
	onkeypress={(e) => e.key === 'Enter' && onclick?.()}
>
	<CardContent class="p-4">
		<div class="flex items-start justify-between gap-4">
			<!-- Left: Main content -->
			<div class="flex-1 min-w-0">
				<!-- Exception type and badges -->
				<div class="flex items-center gap-2 mb-2 flex-wrap">
					<code class="font-mono font-semibold text-red-600 dark:text-red-400 truncate">
						{group.exceptionType}
					</code>
					<LanguageBadge language={group.language} />
					<ErrorGroupStatusBadge status={group.status} />
				</div>

				<!-- Exception message -->
				{#if group.exceptionMessage}
					<p class="text-sm text-muted-foreground line-clamp-2 mb-2 font-mono">
						{group.exceptionMessage}
					</p>
				{/if}

				<!-- Metadata row -->
				<div class="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
					<!-- Occurrence count -->
					<div class="flex items-center gap-1">
						<Hash class="w-3 h-3" />
						<span class="font-semibold text-foreground">{formatOccurrences(group.occurrenceCount)}</span>
						<span>occurrences</span>
					</div>

					<!-- Last seen -->
					<div class="flex items-center gap-1" title={formatDate(group.lastSeen)}>
						<Clock class="w-3 h-3" />
						<span>Last: {formatTimeAgo(group.lastSeen)}</span>
					</div>

					<!-- First seen -->
					<div class="flex items-center gap-1" title={formatDate(group.firstSeen)}>
						<TrendingUp class="w-3 h-3" />
						<span>First: {formatTimeAgo(group.firstSeen)}</span>
					</div>
				</div>

				<!-- Affected services -->
				{#if group.affectedServices && group.affectedServices.length > 0}
					<div class="flex items-center gap-1 mt-2 text-xs">
						<span class="text-muted-foreground">Services:</span>
						<span class="font-mono text-foreground">
							{group.affectedServices.slice(0, 3).join(', ')}
							{#if group.affectedServices.length > 3}
								+{group.affectedServices.length - 3} more
							{/if}
						</span>
					</div>
				{/if}
			</div>

			<div class="flex-shrink-0 flex flex-col gap-2">
				<ChevronRight class="w-5 h-5 text-muted-foreground" />
			</div>
		</div>
	</CardContent>
</Card>
