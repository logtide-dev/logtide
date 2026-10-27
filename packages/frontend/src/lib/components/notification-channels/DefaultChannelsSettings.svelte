<script lang="ts">
	import { notificationChannelsStore } from '$lib/stores/notification-channels';
	import { organizationStore } from '$lib/stores/organization';
	import { NOTIFICATION_EVENT_TYPES } from '@logtide/shared';
	import RoutingEventCard from './RoutingEventCard.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import type { NotificationEventType } from '$lib/api/notification-channels';

	interface Props {
		canEdit?: boolean;
	}

	let { canEdit = true }: Props = $props();

	const DESCRIPTIONS: Record<NotificationEventType, string> = {
		alert: 'An alert rule fires or resolves.',
		sigma: 'A detection rule matches logs.',
		incident: 'A security incident is created.',
		monitoring: 'A monitor goes down or recovers.',
		error: 'A new error group appears or a resolved one comes back.',
		project_health: 'Project stopped sending data, rejected records, clock problems on the sender.',
	};

	let currentOrg = $derived($organizationStore.currentOrganization);
	let defaultsLoading = $derived($notificationChannelsStore.defaultsLoading);

	// Load defaults when org changes
	$effect(() => {
		if (currentOrg?.id) {
			notificationChannelsStore.loadDefaults(currentOrg.id);
		}
	});
</script>

<div class="space-y-4">
	{#if defaultsLoading}
		<div class="flex items-center justify-center py-8">
			<Spinner size="md" />
			<span class="ml-2 text-sm text-muted-foreground">Loading routing...</span>
		</div>
	{:else}
		<div class="grid gap-4">
			{#each NOTIFICATION_EVENT_TYPES as eventType (eventType)}
				<RoutingEventCard {eventType} description={DESCRIPTIONS[eventType]} {canEdit} />
			{/each}
		</div>
	{/if}
</div>
