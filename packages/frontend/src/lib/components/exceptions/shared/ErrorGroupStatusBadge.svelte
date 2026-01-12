<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import type { ErrorGroupStatus } from '$lib/api/exceptions';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import EyeOff from '@lucide/svelte/icons/eye-off';

	interface Props {
		status: ErrorGroupStatus;
		size?: 'sm' | 'md';
	}

	let { status, size = 'sm' }: Props = $props();

	const statusConfig: Record<ErrorGroupStatus, { label: string; color: string; Icon: typeof CircleCheck }> = {
		open: {
			label: 'Open',
			color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
			Icon: CircleAlert,
		},
		resolved: {
			label: 'Resolved',
			color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
			Icon: CircleCheck,
		},
		ignored: {
			label: 'Ignored',
			color: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
			Icon: EyeOff,
		},
	};

	const config = $derived(statusConfig[status]);
	const sizeClass = $derived(size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1');
	const iconSize = $derived(size === 'sm' ? 'w-3 h-3' : 'w-4 h-4');
</script>

<Badge variant="outline" class="{config.color} {sizeClass} flex items-center gap-1">
	<config.Icon class={iconSize} />
	{config.label}
</Badge>
