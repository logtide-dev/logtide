<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import type { IncidentHistoryEntry } from '$lib/api/siem';
	import History from '@lucide/svelte/icons/history';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Search from '@lucide/svelte/icons/search';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import User from '@lucide/svelte/icons/user';
	import Edit from '@lucide/svelte/icons/edit';
	import Plus from '@lucide/svelte/icons/plus';
	import type { ComponentType } from 'svelte';

	interface Props {
		history: IncidentHistoryEntry[];
	}

	let { history }: Props = $props();

	interface ActionConfig {
		icon: ComponentType;
		color: string;
		format: (entry: IncidentHistoryEntry) => string;
	}

	const actionConfigs: Record<string, ActionConfig> = {
		created: {
			icon: Plus,
			color: 'text-green-500 bg-green-500/10',
			format: () => 'Incident created',
		},
		status_changed: {
			icon: getStatusIcon,
			color: 'text-blue-500 bg-blue-500/10',
			format: (entry) => `Status changed from ${formatValue(entry.oldValue)} to ${formatValue(entry.newValue)}`,
		},
		assignee_changed: {
			icon: User,
			color: 'text-purple-500 bg-purple-500/10',
			format: (entry) =>
				entry.newValue ? `Assigned to ${entry.newValue}` : 'Assignee removed',
		},
		severity_changed: {
			icon: AlertCircle,
			color: 'text-orange-500 bg-orange-500/10',
			format: (entry) => `Severity changed from ${formatValue(entry.oldValue)} to ${formatValue(entry.newValue)}`,
		},
		field_changed: {
			icon: Edit,
			color: 'text-gray-500 bg-gray-500/10',
			format: (entry) => `${formatFieldName(entry.fieldName)} updated`,
		},
	};

	function getStatusIcon(_entry: IncidentHistoryEntry): ComponentType {
		// Default to edit icon for status changes
		return Edit;
	}

	function formatValue(value: string | null): string {
		if (!value) return 'none';
		return value.replace(/_/g, ' ');
	}

	function formatFieldName(name: string | null): string {
		if (!name) return 'Field';
		return name
			.replace(/_/g, ' ')
			.replace(/\b\w/g, (l) => l.toUpperCase());
	}

	function formatDate(dateStr: string): string {
		const date = new Date(dateStr);
		return date.toLocaleDateString('it-IT', {
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

		if (diffMins < 1) {
			return 'Just now';
		} else if (diffMins < 60) {
			return `${diffMins}m ago`;
		} else if (diffHours < 24) {
			return `${diffHours}h ago`;
		} else {
			return `${diffDays}d ago`;
		}
	}

	function getActionConfig(action: string): ActionConfig {
		return (
			actionConfigs[action] || {
				icon: Edit,
				color: 'text-gray-500 bg-gray-500/10',
				format: () => action.replace(/_/g, ' '),
			}
		);
	}
</script>

<Card>
	<CardHeader class="pb-3">
		<CardTitle class="text-base font-semibold flex items-center gap-2">
			<History class="w-4 h-4" />
			Activity Timeline
			<span class="text-muted-foreground font-normal">({history.length})</span>
		</CardTitle>
	</CardHeader>
	<CardContent>
		{#if history.length === 0}
			<div class="text-center py-6 text-muted-foreground">
				<History class="w-8 h-8 mx-auto mb-2 opacity-50" />
				<p class="text-sm">No activity recorded</p>
			</div>
		{:else}
			<div class="relative">
				<!-- Timeline line -->
				<div
					class="absolute left-4 top-0 bottom-0 w-px bg-border"
					style="transform: translateX(-50%)"
				></div>

				<div class="space-y-4">
					{#each history as entry}
						{@const config = getActionConfig(entry.action)}
						<div class="relative flex gap-4 pl-8">
							<!-- Icon -->
							<div
								class="absolute left-0 w-8 h-8 rounded-full flex items-center justify-center {config.color}"
								style="transform: translateX(-50%)"
							>
								<config.icon class="w-4 h-4" />
							</div>

							<!-- Content -->
							<div class="flex-1 pb-4">
								<div class="flex items-center gap-2 flex-wrap">
									<span class="text-sm font-medium">
										{config.format(entry)}
									</span>
								</div>
								<div class="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
									{#if entry.userName}
										<span>by {entry.userName}</span>
										<span>·</span>
									{/if}
									<span title={formatDate(entry.createdAt)}>
										{formatTimeAgo(entry.createdAt)}
									</span>
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</CardContent>
</Card>
