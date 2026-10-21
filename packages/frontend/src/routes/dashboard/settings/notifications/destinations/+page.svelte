<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { organizationStore } from '$lib/stores/organization';
	import Button from '$lib/components/ui/button/button.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import { ChannelsList } from '$lib/components/notification-channels';
	import type { OrganizationWithRole } from '@logtide/shared';
	import { canManageMembers } from '@logtide/shared';
	import Plus from '@lucide/svelte/icons/plus';

	let token: string | null = null;
	let currentOrg = $state<OrganizationWithRole | null>(null);
	let createOpen = $state(false);

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
</script>

<svelte:head>
	<title>Destinations - LogTide</title>
</svelte:head>

<div class="space-y-6">
	<PageHeader
		title="Destinations"
		description="Where LogTide sends notifications. Reuse them in alert rules, detection rules, monitors and routing."
		appliesTo="organization"
	>
		{#snippet actions()}
			{#if canManage}
				<Button onclick={() => (createOpen = true)} class="gap-2">
					<Plus class="h-4 w-4" aria-hidden="true" />
					Add destination
				</Button>
			{/if}
		{/snippet}
	</PageHeader>

	<ChannelsList {canManage} bind:createOpen />
</div>
