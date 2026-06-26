<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
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
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Clock from '@lucide/svelte/icons/clock';
	import Hash from '@lucide/svelte/icons/hash';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import FileText from '@lucide/svelte/icons/file-text';
	import BarChart from '@lucide/svelte/icons/bar-chart-2';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import Folder from '@lucide/svelte/icons/folder';
	import Key from '@lucide/svelte/icons/key';
	import { layoutStore } from '$lib/stores/layout';
	import { apiKeysAPI, type ApiKey } from '$lib/api/api-keys';

	// Get group ID from URL
	const groupId = $derived(page.params.id);

	// State
	let group = $state<ErrorGroup | null>(null);
	let trend = $state<ErrorGroupTrendBucket[]>([]);
	let logs = $state<ErrorGroupLog[]>([]);
	let logsTotal = $state(0);
	let apiKeys = $state<ApiKey[]>([]);
	let sampleException = $state<ExceptionWithFrames | null>(null);
	let loading = $state(true);
	let error = $state('');
	let updating = $state(false);
	let copied = $state(false);
	let loadingMore = $state(false);
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
	const organizationId = $derived(page.url.searchParams.get('organizationId') || $currentOrganization?.id || '');

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

			// Load trend data, logs and API keys in parallel
			const promises: [Promise<any>, Promise<any>, Promise<{ apiKeys: ApiKey[] }> | undefined] = [
				getErrorGroupTrend({ groupId, organizationId, interval: '1d', days: 7 }),
				getErrorGroupLogs({ groupId, organizationId, limit: logsPerPage, offset: 0 }),
				group.projectId ? apiKeysAPI.list(group.projectId) : undefined,
			];

			const [trendData, logsData, apiKeysData] = await Promise.all(promises);

			trend = trendData.trend;
			logs = logsData.logs;
			logsTotal = logsData.total;
			if (apiKeysData) {
				apiKeys = apiKeysData.apiKeys;
			}

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

	function getApiKeyName(log: ErrorGroupLog): string | null {
		const apiKeyId = log.metadata?.api_key_id;
		if (!apiKeyId) return null;

		const key = apiKeys.find((k) => k.id === apiKeyId);
		return key ? key.name : 'Unknown key';
	}

	async function loadMoreLogs() {
		if (!group || loadingMore) return;

		loadingMore = true;
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
		} finally {
			loadingMore = false;
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

	function formatDate(dateStr: string | Date): string {
		const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	}

	function formatTimeAgo(dateStr: string | Date): string {
		const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
		const now = new Date();
		const diffMs = Math.max(now.getTime() - date.getTime(), 0);
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) return 'just now';
		if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
		if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
		return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
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
						{#if group.projectName}
							<Badge variant="outline" class="gap-1 font-normal text-muted-foreground ml-2">
								<Folder class="w-3 h-3" />
								{group.projectName}
							</Badge>
						{/if}
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
					value={group.status}
					onValueChange={(v) => {
						if (v && v !== group.status) {
							handleStatusChange(v as ErrorGroupStatus);
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
					<span class="font-bold">{group.occurrenceCount.toLocaleString('en-US')}</span>
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
				<Tabs.Trigger value="logs">Logs ({logsTotal.toLocaleString('en-US')})</Tabs.Trigger>
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
									<div class="flex-1 h-full flex flex-col items-center gap-1">
										<div class="flex-1 w-full flex items-end">
											<div
												class="w-full bg-red-500 rounded-t transition-all hover:bg-red-600 {bucket.count > 0 ? 'min-h-0.5' : ''}"
												style="height: {height}%"
												title="{bucket.count} occurrences on {new Date(bucket.timestamp).toLocaleDateString('en-US')}"
											></div>
										</div>
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
												{#if getApiKeyName(log)}
													<Badge variant="secondary" class="gap-1 font-normal py-0 h-5">
														<Key class="w-3 h-3" />
														{getApiKeyName(log)}
													</Badge>
												{/if}
											</div>
											<div class="flex items-center gap-1 flex-shrink-0">
												{#if log.traceId}
													<Button
														variant="ghost"
														size="sm"
														class="gap-1 text-primary hover:text-primary"
														onclick={() => goto(`/dashboard/traces/${log.traceId}?projectId=${group.projectId}`)}
														title="Open trace timeline"
													>
														View Trace
														<ArrowUpRight class="w-3 h-3" />
													</Button>
												{/if}
												<Button
													variant="ghost"
													size="sm"
													onclick={() => goto(`/dashboard/search?logId=${log.id}&projectId=${group.projectId}`)}
												>
													View Log
												</Button>
											</div>
										</div>
										<p class="text-sm mt-2 font-mono line-clamp-2">{log.message}</p>
									</div>
								{/each}
							</div>

							{#if logs.length < logsTotal}
								<div class="flex justify-center mt-4">
									<Button variant="outline" onclick={loadMoreLogs} disabled={loadingMore}>
										{#if loadingMore}
											<Spinner class="w-4 h-4 mr-2" />
											Loading...
										{:else}
											Load More ({(logsTotal - logs.length).toLocaleString('en-US')} remaining)
										{/if}
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
