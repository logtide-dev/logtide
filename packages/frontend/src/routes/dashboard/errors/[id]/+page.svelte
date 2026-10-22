<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { currentOrganization } from '$lib/stores/organization';
	import { scopeStore, resolveRange, writeScopeToUrl } from '$lib/stores/scope';
	import {
		getErrorGroupById,
		getErrorGroupLogs,
		getErrorGroupEvents,
		getErrorGroupTrends,
		getDuplicateErrorGroups,
		mergeErrorGroups,
		updateErrorGroup,
		type ErrorGroup,
		type ErrorGroupLog,
		type ErrorGroupEvent,
		type ErrorGroupPatch,
		type ErrorGroupTrendsResult,
		type DuplicateErrorGroup,
	} from '$lib/api/exceptions';
	import { organizationsAPI } from '$lib/api/organizations';
	import { apiKeysAPI, type ApiKey } from '$lib/api/api-keys';
	import { toastStore } from '$lib/stores/toast';
	import { layoutStore } from '$lib/stores/layout';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import ScopeBar from '$lib/components/app/ScopeBar.svelte';
	import EmptyState from '$lib/components/app/EmptyState.svelte';
	import Timestamp from '$lib/components/app/Timestamp.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
	import * as Tabs from '$lib/components/ui/tabs';
	import Spinner from '$lib/components/Spinner.svelte';
	import {
		ErrorGroupHeader,
		LatestEventPanel,
		ErrorTrendChart,
	} from '$lib/components/exceptions';
	import type { AssigneeMember, IgnoreOptions } from '$lib/components/exceptions';
	import {
		buildLogsWindowHref,
		buildTraceHref,
	} from '$lib/components/exceptions/error-group-links';
	import { createRequestGuard } from '$lib/components/exceptions/request-guard';
	import FileText from '@lucide/svelte/icons/file-text';
	import Key from '@lucide/svelte/icons/key';
	import GitMerge from '@lucide/svelte/icons/git-merge';

	const TREND_BUCKETS = 48;
	const MAX_TREND_RANGE_MS = 90 * 24 * 60 * 60 * 1000;

	const groupId = $derived(page.params.id);
	const organizationId = $derived(
		page.url.searchParams.get('organizationId') || $currentOrganization?.id || ''
	);

	let group = $state<ErrorGroup | null>(null);
	let members = $state<AssigneeMember[]>([]);
	let apiKeys = $state<ApiKey[]>([]);
	let duplicates = $state<DuplicateErrorGroup[]>([]);
	let loading = $state(true);
	let error = $state('');
	let updating = $state(false);
	let merging = $state(false);

	// Latest event navigation
	let currentEvent = $state<ErrorGroupEvent | null>(null);
	let hasOlder = $state(false);
	let hasNewer = $state(false);
	let eventLoading = $state(false);

	// Trend
	let trend = $state<ErrorGroupTrendsResult | null>(null);

	// Associated logs
	let logs = $state<ErrorGroupLog[]>([]);
	let logsTotal = $state(0);
	let loadingMore = $state(false);
	let logsPage = $state(1);
	const logsPerPage = 10;

	let maxWidthClass = $state('max-w-7xl');
	let containerPadding = $state('px-6 py-8');

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

	const guard = createRequestGuard();
	const trendGuard = createRequestGuard();

	const backHref = $derived.by(() => {
		const url = writeScopeToUrl(new URL(page.url.origin + '/dashboard/errors'), $scopeStore);
		return `/dashboard/errors${url.search}`;
	});

	$effect(() => {
		const id = groupId;
		const org = organizationId;
		if (!browser || !id || !org) return;
		untrack(() => void loadAll(id, org));
	});

	$effect(() => {
		const id = groupId;
		const org = organizationId;
		const scope = $scopeStore;
		if (!browser || !id || !org) return;
		untrack(() => void loadTrend(id, org, scope.range));
	});

	async function loadAll(id: string, org: string) {
		const token = guard.next();
		loading = true;
		error = '';
		currentEvent = null;
		hasOlder = false;
		hasNewer = false;
		logs = [];
		logsPage = 1;
		duplicates = [];

		try {
			const data = await getErrorGroupById(id, org);
			if (!guard.isLatest(token)) return;
			if (!data) {
				error = 'Error not found';
				return;
			}
			group = data;

			const [eventsResult, logsResult, keysResult, membersResult, dupes] = await Promise.all([
				getErrorGroupEvents({ groupId: id, organizationId: org, limit: 1 }).catch(() => null),
				getErrorGroupLogs({ groupId: id, organizationId: org, limit: logsPerPage, offset: 0 }).catch(() => null),
				data.projectId ? apiKeysAPI.list(data.projectId).catch(() => null) : Promise.resolve(null),
				organizationsAPI.getOrganizationMembers(org).catch(() => null),
				getDuplicateErrorGroups(id, org).catch(() => [] as DuplicateErrorGroup[]),
			]);
			if (!guard.isLatest(token)) return;

			if (eventsResult) {
				currentEvent = eventsResult.events[0] ?? null;
				hasOlder = eventsResult.hasOlder;
				hasNewer = eventsResult.hasNewer;
			}
			if (logsResult) {
				logs = logsResult.logs;
				logsTotal = logsResult.total;
			}
			apiKeys = keysResult?.apiKeys ?? [];
			members = (membersResult?.members ?? []).map((m) => ({
				id: m.user.id,
				name: m.user.name,
				email: m.user.email,
			}));
			duplicates = dupes;
		} catch (e) {
			if (!guard.isLatest(token)) return;
			error = e instanceof Error ? e.message : 'Failed to load error';
		} finally {
			if (guard.isLatest(token)) loading = false;
		}
	}

	async function loadTrend(id: string, org: string, range: typeof $scopeStore.range) {
		const token = trendGuard.next();
		const { from, to } = resolveRange(range);
		const start = to.getTime() - from.getTime() > MAX_TREND_RANGE_MS ? new Date(to.getTime() - MAX_TREND_RANGE_MS) : from;
		try {
			const result = await getErrorGroupTrends({
				organizationId: org,
				ids: [id],
				from: start,
				to,
				buckets: TREND_BUCKETS,
			});
			if (trendGuard.isLatest(token)) trend = result;
		} catch {
			if (trendGuard.isLatest(token)) trend = null;
		}
	}

	async function stepEvent(direction: 'older' | 'newer') {
		if (!currentEvent || eventLoading) return;
		eventLoading = true;
		try {
			const result = await getErrorGroupEvents({
				groupId,
				organizationId,
				cursor: currentEvent.cursor,
				direction,
				limit: 1,
			});
			if (result.events.length > 0) {
				currentEvent = result.events[0];
				hasOlder = result.hasOlder;
				hasNewer = result.hasNewer;
			} else if (direction === 'older') {
				hasOlder = false;
			} else {
				hasNewer = false;
			}
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load event');
		} finally {
			eventLoading = false;
		}
	}

	async function applyPatch(patch: ErrorGroupPatch, doneText: string) {
		if (!group || updating) return;
		updating = true;
		try {
			group = await updateErrorGroup(groupId, organizationId, patch);
			toastStore.success(doneText);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to update error');
		} finally {
			updating = false;
		}
	}

	function handleIgnore(options: IgnoreOptions) {
		return applyPatch(
			{
				status: 'ignored',
				ignoredUntil: options.ignoredUntil ?? null,
				ignoreUntilCount: options.ignoreUntilCount ?? null,
			},
			'Error ignored'
		);
	}

	async function mergeDuplicates() {
		if (!group || duplicates.length === 0 || merging) return;
		merging = true;
		try {
			const merged = await mergeErrorGroups(groupId, duplicates.map((d) => d.id), organizationId);
			group = merged;
			const count = duplicates.length;
			duplicates = [];
			toastStore.success(`Merged ${count.toLocaleString('en-US')} duplicate ${count === 1 ? 'error' : 'errors'}`);
			await loadAll(groupId, organizationId);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to merge duplicates');
		} finally {
			merging = false;
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
			const result = await getErrorGroupLogs({
				groupId,
				organizationId,
				limit: logsPerPage,
				offset: logsPage * logsPerPage,
			});
			logs = [...logs, ...result.logs];
			logsPage++;
		} catch {
			toastStore.error('Failed to load more logs');
		} finally {
			loadingMore = false;
		}
	}
</script>

<svelte:head>
	<title>{group?.exceptionType || 'Error'} - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
	<PageHeader
		title={group?.exceptionType ?? 'Error'}
		breadcrumbs={[{ label: 'Errors', href: backHref }, { label: group?.exceptionType ?? 'Error' }]}
	>
		{#snippet actions()}
			<ScopeBar mode="multi" projects={[]} showProjects={false} />
		{/snippet}
	</PageHeader>

	{#if loading}
		<div class="flex items-center justify-center py-24">
			<Spinner />
			<span class="ml-3 text-muted-foreground">Loading error</span>
		</div>
	{:else if error}
		<EmptyState variant="error" title="Could not load this error" description={error}>
			{#snippet actions()}
				<Button variant="outline" size="sm" onclick={() => goto(backHref)}>Back to errors</Button>
			{/snippet}
		</EmptyState>
	{:else if group}
		<ErrorGroupHeader
			{group}
			{members}
			busy={updating}
			onResolve={() => applyPatch({ status: 'resolved' }, 'Error resolved')}
			onReopen={() => applyPatch({ status: 'open' }, 'Error reopened')}
			onIgnore={handleIgnore}
			onAssign={(userId) => applyPatch({ assignedTo: userId }, 'Assignee updated')}
		/>

		{#if duplicates.length > 0}
			<div class="mb-4 flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between">
				<div class="flex items-start gap-2">
					<GitMerge class="mt-0.5 h-5 w-5 shrink-0 text-warning-text" aria-hidden="true" />
					<div>
						<p class="text-sm font-medium">
							{duplicates.length.toLocaleString('en-US')} duplicate {duplicates.length === 1 ? 'error' : 'errors'} found
						</p>
						<p class="text-xs text-muted-foreground">
							Same exception type and message, split by stack fingerprint. Merge them into this error
							({duplicates.reduce((n, d) => n + d.occurrenceCount, 0).toLocaleString('en-US')} extra occurrences).
						</p>
					</div>
				</div>
				<Button size="sm" onclick={mergeDuplicates} disabled={merging}>
					<GitMerge class="mr-1.5 h-4 w-4" aria-hidden="true" />
					{merging ? 'Merging' : `Merge ${duplicates.length.toLocaleString('en-US')}`}
				</Button>
			</div>
		{/if}

		<Card class="mb-4">
			<CardHeader>
				<CardTitle>Events over time</CardTitle>
			</CardHeader>
			<CardContent>
				{#if trend && trend.trends[groupId]}
					<ErrorTrendChart counts={trend.trends[groupId]} from={trend.from} bucketMs={trend.bucketMs} />
				{:else}
					<p class="py-8 text-center text-sm text-muted-foreground">No trend data available</p>
				{/if}
			</CardContent>
		</Card>

		<Tabs.Root value="event" class="w-full">
			<Tabs.List>
				<Tabs.Trigger value="event">Latest event</Tabs.Trigger>
				<Tabs.Trigger value="logs">Associated logs ({logsTotal.toLocaleString('en-US')})</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content value="event" class="mt-4">
				<LatestEventPanel
					event={currentEvent}
					loading={eventLoading}
					{hasOlder}
					{hasNewer}
					projectId={group.projectId}
					onOlder={() => stepEvent('older')}
					onNewer={() => stepEvent('newer')}
				/>
			</Tabs.Content>

			<Tabs.Content value="logs" class="mt-4">
				<Card>
					<CardHeader>
						<CardTitle class="flex items-center gap-2">
							<FileText class="h-5 w-5" aria-hidden="true" />
							Associated logs
						</CardTitle>
						<CardDescription>Log entries that triggered this error</CardDescription>
					</CardHeader>
					<CardContent>
						{#if logs.length > 0}
							<div class="space-y-2">
								{#each logs as log (log.id)}
									<div class="rounded-lg border p-3 transition-colors hover:bg-accent/50">
										<div class="flex items-center justify-between gap-4">
											<div class="flex min-w-0 items-center gap-3">
												<span class="font-mono text-xs text-muted-foreground">
													<Timestamp value={log.time} />
												</span>
												<Badge variant="outline" class="font-mono">{log.service}</Badge>
												{#if getApiKeyName(log)}
													<Badge variant="secondary" class="h-5 gap-1 py-0 font-normal">
														<Key class="h-3 w-3" aria-hidden="true" />
														{getApiKeyName(log)}
													</Badge>
												{/if}
											</div>
											<div class="flex flex-shrink-0 items-center gap-1">
												{#if log.traceId}
													<a
														href={buildTraceHref(log.traceId, group.projectId)}
														class="rounded-sm px-2 py-1 text-sm text-primary-text hover:underline"
													>
														View trace
													</a>
												{/if}
												<a
													href={buildLogsWindowHref({ projectId: group.projectId, time: log.time, logId: log.id })}
													class="rounded-sm px-2 py-1 text-sm text-primary-text hover:underline"
												>
													View log
												</a>
											</div>
										</div>
										<p class="mt-2 line-clamp-2 font-mono text-sm">{log.message}</p>
									</div>
								{/each}
							</div>

							{#if logs.length < logsTotal}
								<div class="mt-4 flex justify-center">
									<Button variant="outline" onclick={loadMoreLogs} disabled={loadingMore}>
										{#if loadingMore}
											<Spinner class="mr-2 h-4 w-4" />
											Loading
										{:else}
											Load more ({(logsTotal - logs.length).toLocaleString('en-US')} remaining)
										{/if}
									</Button>
								</div>
							{/if}
						{:else}
							<div class="py-12 text-center text-muted-foreground">
								<FileText class="mx-auto mb-4 h-12 w-12 opacity-50" aria-hidden="true" />
								<p>No associated logs found</p>
							</div>
						{/if}
					</CardContent>
				</Card>
			</Tabs.Content>
		</Tabs.Root>
	{/if}
</div>
