<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import StackFrameCard from './StackFrameCard.svelte';
	import LanguageBadge from './shared/LanguageBadge.svelte';
	import type { ExceptionWithFrames } from '$lib/api/exceptions';
	import { copyToClipboard } from '$lib/utils/clipboard';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Layers from '@lucide/svelte/icons/layers';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import Filter from '@lucide/svelte/icons/filter';

	interface Props {
		exception: ExceptionWithFrames;
		showRawTrace?: boolean;
		maxFramesInitial?: number;
	}

	let { exception, showRawTrace = false, maxFramesInitial = 10 }: Props = $props();

	let copied = $state(false);
	let showAllFrames = $state(false);
	let showAppCodeOnly = $state(false);
	let showRaw = $state(false);

	// Sync showRaw with prop when it changes
	$effect(() => {
		showRaw = showRawTrace;
	});

	// Filter frames
	const filteredFrames = $derived(
		showAppCodeOnly ? exception.frames.filter((f) => f.isAppCode) : exception.frames
	);

	// Determine how many frames to show
	const visibleFrames = $derived(
		showAllFrames ? filteredFrames : filteredFrames.slice(0, maxFramesInitial)
	);

	// Count app code frames
	const appCodeCount = $derived(exception.frames.filter((f) => f.isAppCode).length);

	async function copyStackTrace() {
		const success = await copyToClipboard(exception.exception.rawStackTrace);
		if (success) {
			copied = true;
			setTimeout(() => (copied = false), 2000);
		}
	}
</script>

<div class="space-y-4">
	<!-- Exception header -->
	<div class="space-y-2">
		<!-- Exception type and language -->
		<div class="flex items-center gap-2 flex-wrap">
			<AlertTriangle class="w-5 h-5 text-red-500 flex-shrink-0" />
			<code class="font-mono text-lg font-semibold text-red-600 dark:text-red-400">
				{exception.exception.exceptionType}
			</code>
			<LanguageBadge language={exception.exception.language} />
		</div>

		<!-- Exception message -->
		{#if exception.exception.exceptionMessage}
			<p class="text-sm text-muted-foreground pl-7">
				{exception.exception.exceptionMessage}
			</p>
		{/if}

		<!-- Frame stats -->
		<div class="flex items-center gap-4 pl-7 text-xs text-muted-foreground">
			<div class="flex items-center gap-1">
				<Layers class="w-3 h-3" />
				<span>{exception.frames.length} frames</span>
			</div>
			<div class="flex items-center gap-1">
				<span class="text-blue-500">{appCodeCount} app code</span>
			</div>
		</div>
	</div>

	<!-- Controls -->
	<div class="flex items-center justify-between gap-2 flex-wrap">
		<div class="flex items-center gap-2">
			<Button
				variant={showAppCodeOnly ? 'default' : 'outline'}
				size="sm"
				class="h-7 text-xs"
				onclick={() => (showAppCodeOnly = !showAppCodeOnly)}
			>
				<Filter class="w-3 h-3 mr-1" />
				{showAppCodeOnly ? 'Showing App Code' : 'Show App Code Only'}
			</Button>

			<Button
				variant={showRaw ? 'default' : 'outline'}
				size="sm"
				class="h-7 text-xs"
				onclick={() => (showRaw = !showRaw)}
			>
				{showRaw ? 'Hide Raw' : 'Show Raw'}
			</Button>
		</div>

		<Button variant="outline" size="sm" class="h-7 text-xs" onclick={copyStackTrace}>
			{#if copied}
				<Check class="w-3 h-3 mr-1" />
				Copied!
			{:else}
				<Copy class="w-3 h-3 mr-1" />
				Copy Stack Trace
			{/if}
		</Button>
	</div>

	<!-- Raw stack trace -->
	{#if showRaw}
		<div class="rounded-md bg-muted p-3">
			<pre class="text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto">{exception.exception.rawStackTrace}</pre>
		</div>
	{/if}

	<!-- Stack frames -->
	<div class="space-y-2">
		{#each visibleFrames as frame, idx}
			<StackFrameCard {frame} index={frame.frameIndex} expanded={idx === 0 && frame.isAppCode} />
		{/each}
	</div>

	<!-- Show more/less button -->
	{#if filteredFrames.length > maxFramesInitial}
		<div class="flex justify-center">
			<Button
				variant="ghost"
				size="sm"
				onclick={() => (showAllFrames = !showAllFrames)}
				class="text-xs"
			>
				{#if showAllFrames}
					<ChevronUp class="w-3 h-3 mr-1" />
					Show Less
				{:else}
					<ChevronDown class="w-3 h-3 mr-1" />
					Show {filteredFrames.length - maxFramesInitial} More Frames
				{/if}
			</Button>
		</div>
	{/if}
</div>
