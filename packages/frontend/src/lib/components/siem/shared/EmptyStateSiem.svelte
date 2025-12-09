<script lang="ts">
	import { Card, CardContent } from '$lib/components/ui/card';
	import Button from '$lib/components/ui/button/button.svelte';
	import Shield from '@lucide/svelte/icons/shield';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import FileSearch from '@lucide/svelte/icons/file-search';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import type { ComponentType } from 'svelte';

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
		{ icon: ComponentType; defaultTitle: string; defaultDescription: string }
	> = {
		incidents: {
			icon: Shield,
			defaultTitle: 'No incidents found',
			defaultDescription:
				'No security incidents have been created yet. Incidents are automatically created when Sigma rules detect threats.',
		},
		detections: {
			icon: AlertTriangle,
			defaultTitle: 'No detection events',
			defaultDescription:
				'No detection events are associated with this incident. Detection events are created when log patterns match Sigma rules.',
		},
		comments: {
			icon: MessageSquare,
			defaultTitle: 'No comments yet',
			defaultDescription:
				'Be the first to add a comment. Use comments to document investigation progress and findings.',
		},
		history: {
			icon: FileSearch,
			defaultTitle: 'No history',
			defaultDescription: 'No changes have been recorded for this incident yet.',
		},
	};

	const config = $derived(configs[type]);
</script>

<Card class="border-2 border-dashed">
	<CardContent class="py-12 text-center">
		<div
			class="w-16 h-16 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center"
		>
			<config.icon class="w-8 h-8 text-primary" />
		</div>
		<h3 class="text-xl font-semibold mb-2">
			{title || config.defaultTitle}
		</h3>
		<p class="text-muted-foreground mb-6 max-w-md mx-auto">
			{description || config.defaultDescription}
		</p>
		{#if actionLabel && onAction}
			<Button onclick={onAction}>
				{actionLabel}
			</Button>
		{/if}
	</CardContent>
</Card>
