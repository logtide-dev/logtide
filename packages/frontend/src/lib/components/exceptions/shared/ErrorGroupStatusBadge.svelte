<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import type { ErrorGroupStatus } from '$lib/api/exceptions';
	import { statusTone } from '../error-status';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import EyeOff from '@lucide/svelte/icons/eye-off';

	interface Props {
		status: ErrorGroupStatus;
		size?: 'sm' | 'md';
	}

	let { status, size = 'sm' }: Props = $props();

	const statusConfig: Record<ErrorGroupStatus, { label: string; Icon: typeof CircleCheck }> = {
		open: { label: 'Open', Icon: CircleAlert },
		resolved: { label: 'Resolved', Icon: CircleCheck },
		ignored: { label: 'Ignored', Icon: EyeOff },
	};

	const config = $derived(statusConfig[status]);
	const tone = $derived(statusTone(status));
	const sizeClass = $derived(size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1');
	const iconSize = $derived(size === 'sm' ? 'w-3 h-3' : 'w-4 h-4');
</script>

<Badge variant="outline" class="{tone.badge} {sizeClass} flex items-center gap-1">
	<config.Icon class={iconSize} aria-hidden="true" />
	{config.label}
</Badge>
