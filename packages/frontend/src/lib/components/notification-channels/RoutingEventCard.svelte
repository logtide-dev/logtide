<script lang="ts">
	import { notificationChannelsStore } from '$lib/stores/notification-channels';
	import { organizationStore } from '$lib/stores/organization';
	import { toastStore } from '$lib/stores/toast';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { NOTIFICATION_EVENT_LABELS } from '@logtide/shared';
	import type { Component } from 'svelte';
	import ChannelSelector from './ChannelSelector.svelte';
	import WillNotify from './WillNotify.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import type { NotificationEventType } from '$lib/api/notification-channels';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Shield from '@lucide/svelte/icons/shield';
	import Bug from '@lucide/svelte/icons/bug';
	import Bell from '@lucide/svelte/icons/bell';
	import Activity from '@lucide/svelte/icons/activity';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';

	interface Props {
		eventType: NotificationEventType;
		description: string;
		canEdit: boolean;
	}

	let { eventType, description, canEdit }: Props = $props();

	const ICONS: Record<NotificationEventType, Component> = {
		alert: Bell as unknown as Component,
		sigma: Shield as unknown as Component,
		incident: AlertTriangle as unknown as Component,
		monitoring: Activity as unknown as Component,
		error: Bug as unknown as Component,
		project_health: HeartPulse as unknown as Component,
	};

	const Icon = $derived(ICONS[eventType]);
	const label = $derived(NOTIFICATION_EVENT_LABELS[eventType]);

	let currentOrg = $derived($organizationStore.currentOrganization);
	let selectedIds = $derived(
		($notificationChannelsStore.defaults[eventType] ?? []).map((ch) => ch.id)
	);

	let saving = $state(false);
	// Re-keys WillNotify after each save so it shows the new result.
	let version = $state(0);

	async function handleChange(channelIds: string[]) {
		if (!currentOrg || !canEdit) return;

		saving = true;
		try {
			await notificationChannelsStore.setDefaults(currentOrg.id, eventType, channelIds);
			version += 1;
			toastStore.success('Routing updated');
		} catch (err) {
			toastStore.error(err instanceof Error ? err.message : 'Failed to update routing');
		} finally {
			saving = false;
		}
	}
</script>

<Card>
	<CardHeader class="pb-3">
		<div class="flex items-center gap-3">
			<div class="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
				<Icon class="h-5 w-5 text-primary" aria-hidden="true" />
			</div>
			<div class="flex-1">
				<CardTitle class="flex items-center gap-2 text-base">
					{label}
					{#if saving}
						<Spinner size="sm" />
					{/if}
				</CardTitle>
				<CardDescription>{description}</CardDescription>
			</div>
		</div>
	</CardHeader>
	<CardContent class="space-y-2">
		<ChannelSelector
			{selectedIds}
			onSelectionChange={handleChange}
			disabled={!canEdit || saving}
			showCreateButton={canEdit}
			placeholder="No default destinations"
		/>
		<p class="text-xs text-muted-foreground">If none: email organization owners and admins.</p>
		{#key version}
			<WillNotify {eventType} />
		{/key}
	</CardContent>
</Card>
