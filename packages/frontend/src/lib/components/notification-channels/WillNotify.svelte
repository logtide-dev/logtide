<script lang="ts">
	import { organizationStore } from '$lib/stores/organization';
	import { notificationRoutingAPI } from '$lib/api/notification-routing';
	import type { NotificationRoutingPreview } from '$lib/api/notification-routing';
	import type { NotificationEventType } from '@logtide/shared';

	interface Props {
		eventType: NotificationEventType;
		projectId?: string | null;
		channelIds?: string[];
		class?: string;
	}

	let { eventType, projectId = null, channelIds = [], class: className = '' }: Props = $props();

	const DEBOUNCE_MS = 200;
	const ROUTING_HREF = '/dashboard/settings/notifications/routing';

	let orgId = $state<string | null>(null);
	let preview = $state<NotificationRoutingPreview | null>(null);
	let failed = $state(false);

	$effect(() => {
		const unsubscribe = organizationStore.subscribe((state) => {
			orgId = state.currentOrganization?.id ?? null;
		});
		return unsubscribe;
	});

	let sequence = 0;

	$effect(() => {
		const organizationId = orgId;
		const type = eventType;
		const project = projectId;
		const ids = [...(channelIds ?? [])].sort();

		if (!organizationId) return;

		let active = true;
		const controller = new AbortController();
		const current = ++sequence;

		const timer = setTimeout(async () => {
			try {
				const result = await notificationRoutingAPI.preview(
					{ organizationId, eventType: type, projectId: project, channelIds: ids },
					controller.signal
				);
				if (!active || current !== sequence) return;
				preview = result;
				failed = false;
			} catch {
				if (!active || current !== sequence) return;
				failed = true;
			}
		}, DEBOUNCE_MS);

		return () => {
			active = false;
			clearTimeout(timer);
			controller.abort();
		};
	});

	const sentence = $derived.by(() => {
		if (failed) return 'Could not load recipients';
		if (!preview) return 'Checking recipients';
		const list = preview.destinations.map((d) => `${d.name} (${d.type})`).join(', ');
		const hasDestinations = preview.destinations.length > 0;
		if (hasDestinations && preview.fallback) {
			return `Will notify: ${list}. Will also email organization owners and admins`;
		}
		if (hasDestinations) return `Will notify: ${list}`;
		if (preview.fallback) return 'Will email organization owners and admins';
		return 'Nobody will be notified';
	});
</script>

{#if orgId}
	<p data-testid="will-notify" aria-live="polite" class="text-sm text-muted-foreground {className}">
		<span data-testid="will-notify-text">{sentence}</span>
		<a href={ROUTING_HREF} class="underline underline-offset-2 hover:text-foreground">Edit routing</a>
	</p>
{/if}
