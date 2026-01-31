<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { currentOrganization } from '$lib/stores/organization';
	import {
		getErrorGroups,
		type ErrorGroup,
		type ErrorGroupStatus,
		type ExceptionLanguage,
	} from '$lib/api/exceptions';
	import { toastStore } from '$lib/stores/toast';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import Input from '$lib/components/ui/input/input.svelte';
	import * as Select from '$lib/components/ui/select';
	import Spinner from '$lib/components/Spinner.svelte';
	import { ErrorGroupCard } from '$lib/components/exceptions';
	import Bug from '@lucide/svelte/icons/bug';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Search from '@lucide/svelte/icons/search';
	import Filter from '@lucide/svelte/icons/filter';
	import X from '@lucide/svelte/icons/x';
	import { layoutStore } from '$lib/stores/layout';

	// State
	let groups = $state<ErrorGroup[]>([]);
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
	let total = $state(0);
	let loading = $state(false);
	let error = $state('');
	let lastLoadedOrg = $state<string | null>(null);
	let refreshing = $state(false);

	// Filters
	let statusFilter = $state<ErrorGroupStatus | ''>('');
	let languageFilter = $state<ExceptionLanguage | ''>('');
	let searchQuery = $state('');

	// Pagination
	let currentPage = $state(1);
	let pageSize = $state(20);

	// Derived
	let totalPages = $derived(Math.ceil(total / pageSize));
	let hasActiveFilters = $derived(statusFilter !== '' || languageFilter !== '' || searchQuery !== '');

	// Initialize filters from URL params
	$effect(() => {
		if (!browser) return;

		const params = $page.url.searchParams;
		const statusParam = params.get('status');
		const languageParam = params.get('language');
		const searchParam = params.get('search');

		if (statusParam && ['open', 'resolved', 'ignored'].includes(statusParam)) {
			statusFilter = statusParam as ErrorGroupStatus;
		}
		if (languageParam && ['nodejs', 'python', 'java', 'go', 'php', 'unknown'].includes(languageParam)) {
			languageFilter = languageParam as ExceptionLanguage;
		}
		if (searchParam) {
			searchQuery = searchParam;
		}
	});

	// Load when org changes
	$effect(() => {
		if (!$currentOrganization) return;
		if ($currentOrganization.id === lastLoadedOrg) return;

		loadErrorGroups();
		lastLoadedOrg = $currentOrganization.id;
	});

	async function loadErrorGroups() {
		if (!$currentOrganization) return;

		loading = true;
		error = '';

		try {
			const response = await getErrorGroups({
				organizationId: $currentOrganization.id,
				status: statusFilter || undefined,
				language: languageFilter || undefined,
				search: searchQuery || undefined,
				limit: pageSize,
				offset: (currentPage - 1) * pageSize,
			});

			groups = response.groups;
			total = response.total;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load error groups';
			toastStore.error(error);
		} finally {
			loading = false;
		}
	}

	async function handleRefresh() {
		refreshing = true;
		await loadErrorGroups();
		refreshing = false;
		toastStore.success('Error groups refreshed');
	}

	function handleSearch() {
		currentPage = 1;
		updateUrl();
		loadErrorGroups();
	}

	function handleStatusChange(status: ErrorGroupStatus | '') {
		statusFilter = status;
		currentPage = 1;
		updateUrl();
		loadErrorGroups();
	}

	function handleLanguageChange(language: ExceptionLanguage | '') {
		languageFilter = language;
		currentPage = 1;
		updateUrl();
		loadErrorGroups();
	}

	function handleResetFilters() {
		statusFilter = '';
		languageFilter = '';
		searchQuery = '';
		currentPage = 1;
		updateUrl();
		loadErrorGroups();
	}

	function updateUrl() {
		const params = new URLSearchParams();
		if (statusFilter) params.set('status', statusFilter);
		if (languageFilter) params.set('language', languageFilter);
		if (searchQuery) params.set('search', searchQuery);

		const newUrl = params.toString() ? `?${params}` : '/dashboard/errors';
		goto(newUrl, { replaceState: true, noScroll: true });
	}

	function goToPage(page: number) {
		if (page >= 1 && page <= totalPages && page !== currentPage) {
			currentPage = page;
			loadErrorGroups();
		}
	}

	function viewErrorGroup(group: ErrorGroup) {
		goto(`/dashboard/errors/${group.id}?organizationId=${$currentOrganization?.id}`);
	}

	// Status options for select
	const statusOptions = [
		{ value: '', label: 'All Statuses' },
		{ value: 'open', label: 'Open' },
		{ value: 'resolved', label: 'Resolved' },
		{ value: 'ignored', label: 'Ignored' },
	];

	// Language options for select
	const languageOptions = [
		{ value: '', label: 'All Languages' },
		{ value: 'nodejs', label: 'Node.js' },
		{ value: 'python', label: 'Python' },
		{ value: 'java', label: 'Java' },
		{ value: 'go', label: 'Go' },
		{ value: 'php', label: 'PHP' },
		{ value: 'unknown', label: 'Unknown' },
	];
</script>

<svelte:head>
	<title>Error Groups - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
	<!-- Header -->
	<div class="flex items-center justify-between mb-6">
		<div>
			<div class="flex items-center gap-3 mb-2">
				<Bug class="w-8 h-8 text-red-500" />
				<h1 class="text-3xl font-bold tracking-tight">Error Groups</h1>
			</div>
			<p class="text-muted-foreground">
				Grouped exceptions from your application logs
			</p>
		</div>
		<Button variant="outline" onclick={handleRefresh} disabled={refreshing}>
			<RefreshCw class="w-4 h-4 mr-2 {refreshing ? 'animate-spin' : ''}" />
			Refresh
		</Button>
	</div>

	<!-- Filters -->
	<Card class="mb-6">
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Filter class="w-5 h-5" />
				Filters
			</CardTitle>
		</CardHeader>
		<CardContent>
			<div class="grid gap-4 md:grid-cols-4">
				<!-- Search -->
				<div class="md:col-span-2">
					<div class="relative">
						<Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
						<Input
							type="search"
							placeholder="Search by exception type or message..."
							class="pl-9"
							bind:value={searchQuery}
							onkeydown={(e) => e.key === 'Enter' && handleSearch()}
						/>
					</div>
				</div>

				<!-- Status filter -->
				<Select.Root
					type="single"
					value={{ value: statusFilter, label: statusOptions.find(o => o.value === statusFilter)?.label || 'All Statuses' }}
					onValueChange={(v) => handleStatusChange((v?.value as ErrorGroupStatus | '') || '')}
				>
					<Select.Trigger>
						{statusOptions.find(o => o.value === statusFilter)?.label || 'All Statuses'}
					</Select.Trigger>
					<Select.Content>
						{#each statusOptions as option}
							<Select.Item value={option.value}>{option.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>

				<!-- Language filter -->
				<Select.Root
					type="single"
					value={{ value: languageFilter, label: languageOptions.find(o => o.value === languageFilter)?.label || 'All Languages' }}
					onValueChange={(v) => handleLanguageChange((v?.value as ExceptionLanguage | '') || '')}
				>
					<Select.Trigger>
						{languageOptions.find(o => o.value === languageFilter)?.label || 'All Languages'}
					</Select.Trigger>
					<Select.Content>
						{#each languageOptions as option}
							<Select.Item value={option.value}>{option.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			{#if hasActiveFilters}
				<div class="mt-4 flex items-center gap-2">
					<span class="text-sm text-muted-foreground">Active filters:</span>
					{#if statusFilter}
						<Badge variant="secondary" class="gap-1">
							Status: {statusFilter}
							<button onclick={() => handleStatusChange('')} class="ml-1 hover:text-destructive">
								<X class="w-3 h-3" />
							</button>
						</Badge>
					{/if}
					{#if languageFilter}
						<Badge variant="secondary" class="gap-1">
							Language: {languageFilter}
							<button onclick={() => handleLanguageChange('')} class="ml-1 hover:text-destructive">
								<X class="w-3 h-3" />
							</button>
						</Badge>
					{/if}
					{#if searchQuery}
						<Badge variant="secondary" class="gap-1">
							Search: {searchQuery.slice(0, 20)}{searchQuery.length > 20 ? '...' : ''}
							<button onclick={() => { searchQuery = ''; handleSearch(); }} class="ml-1 hover:text-destructive">
								<X class="w-3 h-3" />
							</button>
						</Badge>
					{/if}
					<Button variant="ghost" size="sm" onclick={handleResetFilters}>
						Clear all
					</Button>
				</div>
			{/if}
		</CardContent>
	</Card>

	<!-- Results -->
	<Card>
		<CardHeader>
			<CardTitle>
				{#if total > 0}
					{total} error group{total !== 1 ? 's' : ''}
				{:else}
					No error groups
				{/if}
			</CardTitle>
		</CardHeader>
		<CardContent>
			{#if loading && groups.length === 0}
				<div class="flex items-center justify-center py-12">
					<Spinner />
					<span class="ml-3 text-muted-foreground">Loading error groups...</span>
				</div>
			{:else if error}
				<div class="text-center py-12 text-destructive">
					<Bug class="w-12 h-12 mx-auto mb-4 opacity-50" />
					<p>{error}</p>
					<Button variant="outline" onclick={handleRefresh} class="mt-4">
						Try Again
					</Button>
				</div>
			{:else if groups.length === 0}
				<div class="text-center py-12">
					<Bug class="w-16 h-16 mx-auto mb-4 text-muted-foreground/50" />
					<h3 class="text-lg font-semibold mb-2">No Error Groups Found</h3>
					<p class="text-muted-foreground mb-4">
						{#if hasActiveFilters}
							No error groups match your current filters.
						{:else}
							Error groups will appear here when exceptions are detected in your logs.
						{/if}
					</p>
					{#if hasActiveFilters}
						<Button variant="outline" onclick={handleResetFilters}>
							Clear Filters
						</Button>
					{/if}
				</div>
			{:else}
				<div class="space-y-3">
					{#each groups as group}
						<ErrorGroupCard {group} onclick={() => viewErrorGroup(group)} />
					{/each}
				</div>

				<!-- Pagination -->
				{#if totalPages > 1}
					<div class="flex items-center justify-between mt-6 px-2">
						<div class="text-sm text-muted-foreground">
							Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, total)} of {total} groups
						</div>
						<div class="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								onclick={() => goToPage(currentPage - 1)}
								disabled={currentPage === 1 || loading}
							>
								<ChevronLeft class="w-4 h-4" />
								Previous
							</Button>
							<span class="text-sm text-muted-foreground px-2">
								Page {currentPage} of {totalPages}
							</span>
							<Button
								variant="outline"
								size="sm"
								onclick={() => goToPage(currentPage + 1)}
								disabled={currentPage === totalPages || loading}
							>
								Next
								<ChevronRight class="w-4 h-4" />
							</Button>
						</div>
					</div>
				{/if}
			{/if}
		</CardContent>
	</Card>
</div>
