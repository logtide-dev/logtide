<script lang="ts">
	import EmptyState from '$lib/components/app/EmptyState.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import Shield from '@lucide/svelte/icons/shield';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import FileSearch from '@lucide/svelte/icons/file-search';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import type { Component } from 'svelte';

	interface Props {
		type: 'incidents' | 'detections' | 'comments' | 'history';
		title?: string;
		description?: string;
		actionLabel?: string;
		onAction?: () => void;
	}

	let { type, title, description, actionLabel, onAction }: Props = $props();

	const configs: Record<
		string,
		{ icon: Component; defaultTitle: string; defaultDescription: string }
	> = {
		incidents: {
			icon: Shield as unknown as Component,
			defaultTitle: 'No incidents found',
			defaultDescription:
				'No security incidents have been created yet. Incidents are created automatically when detection rules find threats.',
		},
		detections: {
			icon: AlertTriangle as unknown as Component,
			defaultTitle: 'No detection events',
			defaultDescription:
				'No detection events are linked to this incident. They are created when log patterns match detection rules.',
		},
		comments: {
			icon: MessageSquare as unknown as Component,
			defaultTitle: 'No comments yet',
			defaultDescription:
				'Be the first to add a comment. Use comments to document investigation progress and findings.',
		},
		history: {
			icon: FileSearch as unknown as Component,
			defaultTitle: 'No history',
			defaultDescription: 'No changes have been recorded for this incident yet.',
		},
	};

	const config = $derived(configs[type]);
</script>

{#if actionLabel && onAction}
	<EmptyState
		variant="no-data"
		icon={config.icon}
		title={title || config.defaultTitle}
		description={description || config.defaultDescription}
	>
		{#snippet actions()}
			<Button onclick={onAction}>
				{actionLabel}
			</Button>
		{/snippet}
	</EmptyState>
{:else}
	<EmptyState
		variant="no-data"
		icon={config.icon}
		title={title || config.defaultTitle}
		description={description || config.defaultDescription}
	/>
{/if}
