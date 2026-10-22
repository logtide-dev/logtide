<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { currentOrganization } from '$lib/stores/organization';
	import { authStore } from '$lib/stores/auth';
	import { scopeStore, resolveRange, writeScopeToUrl } from '$lib/stores/scope';
	import {
		getErrorGroups,
		getErrorGroupTrends,
		bulkUpdateErrorGroups,
		type ErrorGroup,
	} from '$lib/api/exceptions';
	import { projectsAPI } from '$lib/api/projects';
	import { organizationsAPI } from '$lib/api/organizations';
	import { toastStore } from '$lib/stores/toast';
	import { layoutStore } from '$lib/stores/layout';
	import { EXCEPTION_LANGUAGES } from '@logtide/shared';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import ScopeBar from '$lib/components/app/ScopeBar.svelte';
	import Pagination from '$lib/components/app/Pagination.svelte';
	import { rangeLabel as formatRangeLabel } from '$lib/components/time-range/labels';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import Input from '$lib/components/ui/input/input.svelte';
	import * as Select from '$lib/components/ui/select';
	import { ErrorsTable, BulkActionBar } from '$lib/components/exceptions';
	import type { AssigneeMember, IgnoreOptions } from '$lib/components/exceptions';
	import {
		DEFAULT_ERRORS_LIST_STATE,
		parseErrorsListState,
		writeErrorsListState,
		type ErrorsListState,
	} from '$lib/components/exceptions/errors-url-state';
	import { createRequestGuard } from '$lib/components/exceptions/request-guard';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';

	const PAGE_SIZE = 20;
	const TREND_BUCKETS = 24;
	const MAX_TREND_RANGE_MS = 90 * 24 * 60 * 60 * 1000;

	const STATUS_OPTIONS = [
		{ value: 'open', label: 'Open' },
		{ value: 'resolved', label: 'Resolved' },
		{ value: 'ignored', label: 'Ignored' },
		{ value: 'all', label: 'All' },
	];
	const LANGUAGE_LABELS: Record<string, string> = {
		nodejs: 'Node.js',
		python: 'Python',
		java: 'Java',
		go: 'Go',
		php: 'PHP',
		kotlin: 'Kotlin',
		csharp: 'C#',
		rust: 'Rust',
		ruby: 'Ruby',
		unknown: 'Unknown',
	};
	const LANGUAGE_OPTIONS = [
		{ value: '', label: 'All languages' },
		...EXCEPTION_LANGUAGES.map((l) => ({ value: l as string, label: LANGUAGE_LABELS[l] ?? l })),
	];
	const ASSIGNEE_OPTIONS = [
		{ value: '', label: 'Anyone' },
		{ value: 'me', label: 'Assigned to me' },
		{ value: 'unassigned', label: 'Unassigned' },
	];

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

	let groups = $state<ErrorGroup[]>([]);
	let trends = $state<Record<string, number[]>>({});
	let total = $state(0);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let selected = $state<string[]>([]);
	let bulkBusy = $state(false);
	let reloadTick = $state(0);
	let projects = $state<{ id: string; name: string }[]>([]);
	let members = $state<AssigneeMember[]>([]);
	let searchInput = $state('');

	const guard = createRequestGuard();

	// The URL is the single source of list state; scope lives in the scope store.
	const listState = $derived(parseErrorsListState(page.url));
	const rangeText = $derived(formatRangeLabel($scopeStore.range));
	const scopeSearch = $derived.by(() => {
		const url = writeScopeToUrl(new URL(page.url.origin + page.url.pathname), $scopeStore);
		return url.search;
	});
	const serviceFilter = $derived(listState.service);

	$effect(() => {
		searchInput = listState.search;
	});

	function updateState(patch: Partial<ErrorsListState>, resetPage = true) {
		const next: ErrorsListState = {
			...listState,
			...patch,
			page: resetPage && patch.page === undefined ? 1 : (patch.page ?? listState.page),
		};
		goto(writeErrorsListState(page.url, next), {
			replaceState: true,
			keepFocus: true,
			noScroll: true,
		});
	}

	// Projects for the scope bar and members for the assignee pickers.
	let loadedMetaForOrg: string | null = null;
	$effect(() => {
		const orgId = $currentOrganization?.id;
		if (!browser || !orgId || orgId === loadedMetaForOrg) return;
		loadedMetaForOrg = orgId;
		projectsAPI
			.getProjects(orgId)
			.then((res) => {
				if (orgId === $currentOrganization?.id) projects = res.projects.map((p) => ({ id: p.id, name: p.name }));
			})
			.catch(() => {
				projects = [];
			});
		organizationsAPI
			.getOrganizationMembers(orgId)
			.then((res) => {
				if (orgId !== $currentOrganization?.id) return;
				members = res.members.map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email }));
			})
			.catch(() => {
				members = [];
			});
	});

	// Org switch resets the page so the offset stays inside the new result set.
	let lastOrg: string | null = null;
	$effect(() => {
		const orgId = $currentOrganization?.id ?? null;
		if (orgId && lastOrg && orgId !== lastOrg && untrack(() => listState.page) > 1) {
			untrack(() => updateState({ page: 1 }, false));
		}
		if (orgId) lastOrg = orgId;
	});

	$effect(() => {
		const orgId = $currentOrganization?.id;
		const scope = $scopeStore;
		const state = listState;
		void reloadTick;
		if (!browser || !orgId) return;
		untrack(() => {
			selected = [];
			void load(orgId, scope, state);
		});
	});

	async function load(orgId: string, scope: typeof $scopeStore, state: ErrorsListState) {
		const token = guard.next();
		loading = true;
		error = null;

		const { from, to } = resolveRange(scope.range);
		const userId = $authStore.user?.id;

		try {
			const response = await getErrorGroups({
				organizationId: orgId,
				projectIds: scope.projectIds.length > 0 ? scope.projectIds : undefined,
				status: state.status === 'all' ? undefined : state.status,
				language: state.language || undefined,
				search: state.search || undefined,
				from,
				to,
				sort: state.sort,
				assignedTo: state.assignee === 'me' ? userId : state.assignee === 'unassigned' ? 'unassigned' : undefined,
				service: state.service || undefined,
				limit: PAGE_SIZE,
				offset: (state.page - 1) * PAGE_SIZE,
			});
			if (!guard.isLatest(token)) return;

			groups = response.groups;
			total = response.total;
			trends = {};

			const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
			if (state.page > pages) {
				updateState({ page: pages }, false);
				return;
			}
			void loadTrends(orgId, response.groups, from, to, token);
		} catch (e) {
			if (!guard.isLatest(token)) return;
			error = e instanceof Error ? e.message : 'Failed to load errors';
			groups = [];
			total = 0;
		} finally {
			if (guard.isLatest(token)) loading = false;
		}
	}

	// Trends are cosmetic: a failure leaves the sparklines empty.
	async function loadTrends(orgId: string, rows: ErrorGroup[], from: Date, to: Date, token: number) {
		if (rows.length === 0) return;
		const start = to.getTime() - from.getTime() > MAX_TREND_RANGE_MS ? new Date(to.getTime() - MAX_TREND_RANGE_MS) : from;
		try {
			const result = await getErrorGroupTrends({
				organizationId: orgId,
				ids: rows.map((g) => g.id),
				from: start,
				to,
				buckets: TREND_BUCKETS,
			});
			if (guard.isLatest(token)) trends = result.trends;
		} catch {
			// non-fatal
		}
	}

	function refresh() {
		reloadTick += 1;
		toastStore.success('Errors refreshed');
	}

	function handleSort(key: string) {
		if (key === 'last_seen' || key === 'first_seen' || key === 'events') updateState({ sort: key });
	}

	function handleWiden(preset: '24h' | '7d' | '30d') {
		scopeStore.setRange({ kind: 'preset', preset });
		goto(writeScopeToUrl(page.url, scopeStore.get()), { replaceState: true, keepFocus: true, noScroll: true });
	}

	function clearFilters() {
		updateState({ status: DEFAULT_ERRORS_LIST_STATE.status, language: '', search: '', assignee: '', service: '' });
	}

	function openGroup(group: ErrorGroup) {
		goto(`/dashboard/errors/${encodeURIComponent(group.id)}${scopeSearch}`);
	}

	async function runBulk(
		action: 'resolve' | 'reopen' | 'ignore' | 'assign',
		doneText: string,
		extra: { assignedTo?: string | null; ignoredUntil?: string | null; ignoreUntilCount?: number | null } = {}
	) {
		const orgId = $currentOrganization?.id;
		if (!orgId || selected.length === 0) return;
		bulkBusy = true;
		try {
			const result = await bulkUpdateErrorGroups({ organizationId: orgId, ids: selected, action, ...extra });
			const n = result.updated.length;
			toastStore.success(`${n.toLocaleString('en-US')} ${n === 1 ? 'error' : 'errors'} ${doneText}`);
			if (result.skipped.length > 0) {
				toastStore.warning(`${result.skipped.length.toLocaleString('en-US')} skipped`);
			}
			selected = [];
			reloadTick += 1;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to update errors');
		} finally {
			bulkBusy = false;
		}
	}

	function bulkIgnore(options: IgnoreOptions) {
		return runBulk('ignore', 'ignored', {
			ignoredUntil: options.ignoredUntil ?? null,
			ignoreUntilCount: options.ignoreUntilCount ?? null,
		});
	}

	function statusLabel(value: string): string {
		return STATUS_OPTIONS.find((o) => o.value === value)?.label ?? 'Open';
	}
</script>

<svelte:head>
	<title>Errors - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
	<PageHeader title="Errors" description="Grouped exceptions from your logs">
		{#snippet actions()}
			<div class="flex flex-wrap items-center gap-2">
				<ScopeBar mode="multi" {projects} />
				<Button variant="outline" size="sm" onclick={refresh} disabled={loading}>
					<RefreshCw class="mr-2 h-4 w-4 {loading ? 'animate-spin' : ''}" aria-hidden="true" />
					Refresh
				</Button>
			</div>
		{/snippet}
	</PageHeader>

	<div class="mb-4 flex flex-wrap items-center gap-2">
		<div class="relative min-w-[14rem] flex-1">
			<Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
			<Input
				type="search"
				placeholder="Search by exception type or message"
				aria-label="Search errors"
				class="pl-9"
				bind:value={searchInput}
				onkeydown={(e) => e.key === 'Enter' && updateState({ search: searchInput.trim() })}
				onblur={() => searchInput.trim() !== listState.search && updateState({ search: searchInput.trim() })}
			/>
		</div>

		<Select.Root type="single" value={listState.status} onValueChange={(v) => updateState({ status: (v || 'open') as ErrorsListState['status'] })}>
			<Select.Trigger class="w-36" aria-label="Status">{statusLabel(listState.status)}</Select.Trigger>
			<Select.Content>
				{#each STATUS_OPTIONS as option (option.value)}
					<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>

		<Select.Root type="single" value={listState.language} onValueChange={(v) => updateState({ language: (v || '') as ErrorsListState['language'] })}>
			<Select.Trigger class="w-40" aria-label="Language">
				{LANGUAGE_OPTIONS.find((o) => o.value === listState.language)?.label ?? 'All languages'}
			</Select.Trigger>
			<Select.Content>
				{#each LANGUAGE_OPTIONS as option (option.value)}
					<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>

		<Select.Root type="single" value={listState.assignee} onValueChange={(v) => updateState({ assignee: (v || '') as ErrorsListState['assignee'] })}>
			<Select.Trigger class="w-44" aria-label="Assignee">
				{ASSIGNEE_OPTIONS.find((o) => o.value === listState.assignee)?.label ?? 'Anyone'}
			</Select.Trigger>
			<Select.Content>
				{#each ASSIGNEE_OPTIONS as option (option.value)}
					<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>

		{#if serviceFilter}
			<Badge variant="secondary" class="gap-1">
				Service: {serviceFilter}
				<button
					type="button"
					class="ml-1 rounded-sm hover:text-destructive"
					aria-label="Remove service filter"
					onclick={() => updateState({ service: '' })}
				>
					<X class="h-3 w-3" aria-hidden="true" />
				</button>
			</Badge>
		{/if}
	</div>

	<p class="mb-3 text-sm text-muted-foreground">Last seen in {rangeText}</p>

	{#if selected.length > 0}
		<div class="mb-3">
			<BulkActionBar
				count={selected.length}
				{members}
				busy={bulkBusy}
				onResolve={() => runBulk('resolve', 'resolved')}
				onReopen={() => runBulk('reopen', 'reopened')}
				onIgnore={bulkIgnore}
				onAssign={(userId) => runBulk('assign', 'updated', { assignedTo: userId })}
				onClear={() => (selected = [])}
			/>
		</div>
	{/if}

	<ErrorsTable
		{groups}
		{trends}
		{loading}
		{error}
		bind:selected
		sort={{ key: listState.sort, dir: 'desc' }}
		state={listState}
		rangeLabel={rangeText}
		{scopeSearch}
		onRetry={() => (reloadTick += 1)}
		onWidenRange={handleWiden}
		onShowAllStatuses={() => updateState({ status: 'all' })}
		onClearFilters={clearFilters}
		onOpen={openGroup}
		onSort={handleSort}
	/>

	{#if total > 0 && !error}
		<div class="mt-4">
			<Pagination
				page={listState.page}
				pageSize={PAGE_SIZE}
				{total}
				onPageChange={(p) => updateState({ page: p }, false)}
			/>
		</div>
	{/if}
</div>
