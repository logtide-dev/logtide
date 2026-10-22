<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { organizationStore } from '$lib/stores/organization';
	import { notificationChannelsStore } from '$lib/stores/notification-channels';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import EmptyState from '$lib/components/app/EmptyState.svelte';
	import DataTable from '$lib/components/app/DataTable.svelte';
	import type { DataTableColumn } from '$lib/components/app/data-table';
	import {
		DefaultChannelsSettings,
		DestinationTypeIcon,
	} from '$lib/components/notification-channels';
	import type { RoutingOverride } from '$lib/api/notification-channels';
	import type { OrganizationWithRole } from '@logtide/shared';
	import { canManageMembers, NOTIFICATION_EVENT_LABELS } from '@logtide/shared';

	let token: string | null = null;
	let currentOrg = $state<OrganizationWithRole | null>(null);

	const unsubAuthStore = authStore.subscribe((state) => {
		token = state.token;
	});

	const unsubOrgStore = organizationStore.subscribe((state) => {
		currentOrg = state.currentOrganization;
	});

	onDestroy(() => {
		unsubAuthStore();
		unsubOrgStore();
	});

	onMount(() => {
		if (!token) {
			goto('/login');
			return;
		}
	});

	let canManage = $derived(currentOrg ? canManageMembers(currentOrg.role) : false);
	let overrides = $derived($notificationChannelsStore.overrides);
	let overridesLoading = $derived($notificationChannelsStore.overridesLoading);

	$effect(() => {
		if (currentOrg?.id) {
			notificationChannelsStore.loadOverrides(currentOrg.id);
		}
	});

	function overrideHref(row: RoutingOverride): string {
		switch (row.kind) {
			case 'alert_rule':
				return '/dashboard/alerts';
			case 'sigma_rule':
				return `/dashboard/security/rules/${row.id}`;
			case 'monitor':
				return '/dashboard/uptime';
			case 'error_group':
				return `/dashboard/errors/${row.id}`;
		}
	}

	// Top-level snippets are typed as plain functions; DataTable wants branded Snippets.
	const asCell = (cell: unknown) => cell as Snippet<[RoutingOverride]>;

	const columns: DataTableColumn<RoutingOverride>[] = [
		{ key: 'rule', header: 'Rule', cell: asCell(ruleCell) },
		{ key: 'event', header: 'Event', cell: asCell(eventCell) },
		{ key: 'destinations', header: 'Destinations', cell: asCell(destinationsCell) },
	];
</script>

{#snippet ruleCell(row: RoutingOverride)}
	<a href={overrideHref(row)} class="font-medium hover:underline">{row.name}</a>
{/snippet}

{#snippet eventCell(row: RoutingOverride)}
	<span class="text-sm text-muted-foreground">{NOTIFICATION_EVENT_LABELS[row.eventType]}</span>
{/snippet}

{#snippet destinationsCell(row: RoutingOverride)}
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
		{#each row.channels as channel (channel.id)}
			<span class="inline-flex items-center gap-1.5 text-sm">
				<DestinationTypeIcon type={channel.type} class="!size-6" />
				{channel.name}
			</span>
		{/each}
	</div>
{/snippet}

<svelte:head>
	<title>Routing - LogTide</title>
</svelte:head>

<div class="space-y-6">
	<PageHeader
		title="Routing"
		description="Default destinations for each kind of event. A rule with its own destinations ignores these."
		appliesTo="organization"
	/>

	{#if !canManage}
		<p class="text-sm text-muted-foreground">
			Only organization admins and owners can change routing.
		</p>
	{/if}

	<DefaultChannelsSettings canEdit={canManage} />

	<section class="space-y-3" aria-labelledby="overrides-heading">
		<h2 id="overrides-heading" class="text-lg font-semibold">Rules with their own destinations</h2>
		{#if !overridesLoading && overrides.length === 0}
			<EmptyState
				variant="no-data"
				title="No rules override the defaults"
				description="Rules, monitors and error groups that pick their own destinations show up here."
			/>
		{:else}
			<div class="rounded-md border">
				<DataTable
					{columns}
					rows={overrides}
					rowKey={(r: RoutingOverride) => `${r.kind}:${r.id}`}
					loading={overridesLoading}
				/>
			</div>
		{/if}
	</section>
</div>
