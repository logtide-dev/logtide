<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { currentOrganization } from '$lib/stores/organization';
	import {
		getErrorGroupById,
		getErrorGroupTrend,
		getErrorGroupLogs,
		updateErrorGroupStatus,
		getExceptionByLogId,
		type ErrorGroup,
		type ErrorGroupStatus,
		type ErrorGroupTrendBucket,
		type ErrorGroupLog,
		type ExceptionWithFrames,
	} from '$lib/api/exceptions';
	import { toastStore } from '$lib/stores/toast';
	import { copyToClipboard } from '$lib/utils/clipboard';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
	import * as Tabs from '$lib/components/ui/tabs';
	import * as Select from '$lib/components/ui/select';
	import Spinner from '$lib/components/Spinner.svelte';
	import { StackTraceViewer, LanguageBadge, ErrorGroupStatusBadge } from '$lib/components/exceptions';
	import Bug from '@lucide/svelte/icons/bug';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Clock from '@lucide/svelte/icons/clock';
	import Hash from '@lucide/svelte/icons/hash';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import FileText from '@lucide/svelte/icons/file-text';
	import BarChart from '@lucide/svelte/icons/bar-chart-2';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import { layoutStore } from '$lib/stores/layout';

	// Get group ID from URL
	const groupId = $derived($page.params.id);

	// State
	let group = $state<ErrorGroup | null>(null);
	let trend = $state<ErrorGroupTrendBucket[]>([]);
	let logs = $state<ErrorGroupLog[]>([]);
	let logsTotal = $state(0);
	let sampleException = $state<ExceptionWithFrames | null>(null);
	let loading = $state(true);
	let error = $state('');
	let updating = $state(false);
	let copied = $state(false);
	let maxWidthClass = $state("max-w-7xl");
	let containerPadding = $state("px-6 py-8");

	$effect(() => {
		const unsubscribe = layoutStore.maxWidthClass.subscribe((value) => {
			maxWidthClass = value;
		});
		return unsubscribe;
	});

	$effect(() => {
		const unsubscribe = layoutStore.containerPadding.subscribe((value) => {
			containerPadding = value;
		});
		return unsubscribe;
	});

	// Pagination for logs
	let logsPage = $state(1);
	let logsPerPage = 10;

	// Get organizationId from URL or store
	const organizationId = $derived($page.url.searchParams.get('organizationId') || $currentOrganization?.id || '');

	$effect(() => {
		if (!browser) return;
		if (!groupId || !organizationId) return;

		loadErrorGroup();
	});

	async function loadErrorGroup() {
		loading = true;
		error = '';

		try {
			// Load group details
			const groupData = await getErrorGroupById(groupId, organizationId);
			if (!groupData) {
				error = 'Error group not found';
				loading = false;
				return;
			}
			group = groupData;

			// Load trend data and logs in parallel
			const [trendData, logsData] = await Promise.all([
				getErrorGroupTrend({ groupId, organizationId, interval: '1d', days: 7 }),
				getErrorGroupLogs({ groupId, organizationId, limit: logsPerPage, offset: 0 }),
			]);

			trend = trendData.trend;
			logs = logsData.logs;
			logsTotal = logsData.total;

			// Load sample exception from first log
			if (group.sampleLogId) {
				try {
					sampleException = await getExceptionByLogId(group.sampleLogId, organizationId);
				} catch (e) {
					console.warn('Failed to load sample exception:', e);
				}
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load error group';
			toastStore.error(error);
		} finally {
			loading = false;
		}
	}

	async function loadMoreLogs() {
		if (!group) return;

		try {
			const logsData = await getErrorGroupLogs({
				groupId,
				organizationId,
				limit: logsPerPage,
				offset: logsPage * logsPerPage,
			});

			logs = [...logs, ...logsData.logs];
			logsPage++;
		} catch (e) {
			toastStore.error('Failed to load more logs');
		}
	}

	async function handleStatusChange(newStatus: ErrorGroupStatus) {
		if (!group) return;

		updating = true;
		try {
			const updated = await updateErrorGroupStatus(groupId, organizationId, newStatus);
			group = updated;
			toastStore.success(`Status changed to ${newStatus}`);
		} catch (e) {
			toastStore.error('Failed to update status');
		} finally {
			updating = false;
		}
	}

	async function copyFingerprint() {
		if (!group) return;
		const success = await copyToClipboard(group.fingerprint);
		if (success) {
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} else {
			toastStore.error('Could not copy. Please select and copy manually.');
		}
	}

	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
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

		if (diffMins < 60) return `${diffMins} minutes ago`;
		if (diffHours < 24) return `${diffHours} hours ago`;
		return `${diffDays} days ago`;
	}

	// Status options
	const statusOptions = [
		{ value: 'open', label: 'Open' },
		{ value: 'resolved', label: 'Resolved' },
		{ value: 'ignored', label: 'Ignored' },
	];
</script>

<svelte:head>
	<title>{group?.exceptionType || 'Error Group'} - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
	<!-- Back button -->
	<Button variant="ghost" onclick={() => goto('/dashboard/errors')} class="mb-4">
		<ArrowLeft class="w-4 h-4 mr-2" />
		Back to Error Groups
	</Button>

	{#if loading}
		<div class="flex items-center justify-center py-24">
			<Spinner />
			<span class="ml-3 text-muted-foreground">Loading error group...</span>
		</div>
	{:else if error}
		<div class="text-center py-24">
			<Bug class="w-16 h-16 mx-auto mb-4 text-muted-foreground/50" />
			<h2 class="text-xl font-semibold mb-2">Error</h2>
			<p class="text-muted-foreground mb-4">{error}</p>
			<Button onclick={() => goto('/dashboard/errors')}>Go Back</Button>
		</div>
	{:else if group}
		<!-- Header -->
		<div class="mb-6">
			<div class="flex items-start justify-between gap-4 mb-4">
				<div class="flex-1 min-w-0">
					<div class="flex items-center gap-2 mb-2 flex-wrap">
						<Bug class="w-6 h-6 text-red-500 flex-shrink-0" />
						<code class="font-mono text-xl font-bold text-red-600 dark:text-red-400 truncate">
							{group.exceptionType}
						</code>
						<LanguageBadge language={group.language} size="md" />
						<ErrorGroupStatusBadge status={group.status} size="md" />
					</div>
					{#if group.exceptionMessage}
						<p class="text-muted-foreground font-mono text-sm mt-2">
							{group.exceptionMessage}
						</p>
					{/if}
				</div>

				<!-- Status dropdown -->
				<Select.Root
					type="single"
					value={{ value: group.status, label: statusOptions.find(o => o.value === group.status)?.label || '' }}
					onValueChange={(v) => {
						const newStatus = typeof v === 'string' ? v : v?.value;
						if (newStatus && newStatus !== group.status) {
							handleStatusChange(newStatus as ErrorGroupStatus);
						}
					}}
					disabled={updating}
				>
					<Select.Trigger class="w-36">
						{#if updating}
							Updating...
						{:else}
							{statusOptions.find(o => o.value === group.status)?.label || 'Select status'}
						{/if}
					</Select.Trigger>
					<Select.Content>
						{#each statusOptions as option}
							<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<!-- Stats -->
			<div class="flex items-center gap-6 text-sm flex-wrap">
				<div class="flex items-center gap-2">
					<Hash class="w-4 h-4 text-muted-foreground" />
					<span class="font-bold">{group.occurrenceCount.toLocaleString()}</span>
					<span class="text-muted-foreground">occurrences</span>
				</div>
				<div class="flex items-center gap-2" title={formatDate(group.lastSeen)}>
					<Clock class="w-4 h-4 text-muted-foreground" />
					<span class="text-muted-foreground">Last seen:</span>
					<span>{formatTimeAgo(group.lastSeen)}</span>
				</div>
				<div class="flex items-center gap-2" title={formatDate(group.firstSeen)}>
					<TrendingUp class="w-4 h-4 text-muted-foreground" />
					<span class="text-muted-foreground">First seen:</span>
					<span>{formatTimeAgo(group.firstSeen)}</span>
				</div>
				<div class="flex items-center gap-1">
					<span class="text-muted-foreground font-mono text-xs">
						{group.fingerprint.slice(0, 12)}...
					</span>
					<Button variant="ghost" size="icon" class="h-6 w-6" onclick={copyFingerprint}>
						{#if copied}
							<Check class="w-3 h-3 text-green-500" />
						{:else}
							<Copy class="w-3 h-3" />
						{/if}
					</Button>
				</div>
			</div>

			<!-- Affected services -->
			{#if group.affectedServices && group.affectedServices.length > 0}
				<div class="flex items-center gap-2 mt-3">
					<span class="text-sm text-muted-foreground">Affected services:</span>
					{#each group.affectedServices as service}
						<Badge variant="outline" class="font-mono">{service}</Badge>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Tabs -->
		<Tabs.Root value="stacktrace" class="w-full">
			<Tabs.List>
				<Tabs.Trigger value="stacktrace">Stack Trace</Tabs.Trigger>
				<Tabs.Trigger value="trend">Trend</Tabs.Trigger>
				<Tabs.Trigger value="logs">Logs ({logsTotal})</Tabs.Trigger>
			</Tabs.List>

			<!-- Stack Trace Tab -->
			<Tabs.Content value="stacktrace" class="mt-4">
				<Card>
					<CardHeader>
						<CardTitle>Sample Stack Trace</CardTitle>
						<CardDescription>
							Stack trace from the most recent occurrence
						</CardDescription>
					</CardHeader>
					<CardContent>
						{#if sampleException}
							<StackTraceViewer exception={sampleException} />
						{:else}
							<div class="text-center py-12 text-muted-foreground">
								<Bug class="w-12 h-12 mx-auto mb-4 opacity-50" />
								<p>No stack trace available for this error group</p>
							</div>
						{/if}
					</CardContent>
				</Card>
			</Tabs.Content>

			<!-- Trend Tab -->
			<Tabs.Content value="trend" class="mt-4">
				<Card>
					<CardHeader>
						<CardTitle class="flex items-center gap-2">
							<BarChart class="w-5 h-5" />
							Occurrence Trend (Last 7 Days)
						</CardTitle>
					</CardHeader>
					<CardContent>
						{#if trend.length > 0}
							<div class="h-48 flex items-end justify-between gap-1">
								{#each trend as bucket}
									{@const maxCount = Math.max(...trend.map((t) => t.count), 1)}
									{@const height = (bucket.count / maxCount) * 100}
									<div class="flex-1 flex flex-col items-center gap-1">
										<div
											class="w-full bg-red-500 rounded-t transition-all hover:bg-red-600"
											style="height: {height}%"
											title="{bucket.count} occurrences on {new Date(bucket.timestamp).toLocaleDateString()}"
										></div>
										<span class="text-xs text-muted-foreground">
											{new Date(bucket.timestamp).toLocaleDateString('en-US', { weekday: 'short' })}
										</span>
									</div>
								{/each}
							</div>
						{:else}
							<div class="text-center py-12 text-muted-foreground">
								<BarChart class="w-12 h-12 mx-auto mb-4 opacity-50" />
								<p>No trend data available</p>
							</div>
						{/if}
					</CardContent>
				</Card>
			</Tabs.Content>

			<!-- Logs Tab -->
			<Tabs.Content value="logs" class="mt-4">
				<Card>
					<CardHeader>
						<CardTitle class="flex items-center gap-2">
							<FileText class="w-5 h-5" />
							Associated Logs
						</CardTitle>
						<CardDescription>
							Log entries that triggered this error group
						</CardDescription>
					</CardHeader>
					<CardContent>
						{#if logs.length > 0}
							<div class="space-y-2">
								{#each logs as log}
									<div class="border rounded-lg p-3 hover:bg-accent/50 transition-colors">
										<div class="flex items-center justify-between gap-4">
											<div class="flex items-center gap-3 min-w-0">
												<span class="text-xs text-muted-foreground font-mono">
													{formatDate(log.time)}
												</span>
												<Badge variant="outline" class="font-mono">{log.service}</Badge>
											</div>
											<Button
												variant="ghost"
												size="sm"
												onclick={() => goto(`/dashboard/search?logId=${log.id}&projectId=${group.projectId}`)}
											>
												View Log
											</Button>
										</div>
										<p class="text-sm mt-2 font-mono line-clamp-2">{log.message}</p>
									</div>
								{/each}
							</div>

							{#if logs.length < logsTotal}
								<div class="flex justify-center mt-4">
									<Button variant="outline" onclick={loadMoreLogs}>
										Load More ({logsTotal - logs.length} remaining)
									</Button>
								</div>
							{/if}
						{:else}
							<div class="text-center py-12 text-muted-foreground">
								<FileText class="w-12 h-12 mx-auto mb-4 opacity-50" />
								<p>No associated logs found</p>
							</div>
						{/if}
					</CardContent>
				</Card>
			</Tabs.Content>
		</Tabs.Root>
	{/if}
</div>
