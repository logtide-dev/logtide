<script lang="ts">
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import type { StackFrame } from '$lib/api/exceptions';
	import FileCode from '@lucide/svelte/icons/file-code';
	import Code from '@lucide/svelte/icons/code';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import Package from '@lucide/svelte/icons/package';

	interface Props {
		frame: StackFrame;
		index: number;
		expanded?: boolean;
	}

	let { frame, index, expanded = false }: Props = $props();
	// Initialize with the prop value, but manage as local state for toggle
	let isExpanded = $state(false);

	// Sync with prop when it changes
	$effect(() => {
		isExpanded = expanded;
	});

	// Extract filename from path
	const fileName = $derived(frame.filePath.split(/[/\\]/).pop() || frame.filePath);

	// Format function name for display
	const displayFunction = $derived(frame.functionName || '<anonymous>');

	// Determine if it's a library/vendor frame
	const isLibraryCode = $derived(!frame.isAppCode);
</script>

<Card
	class="border-l-4 {frame.isAppCode
		? 'border-l-blue-500 bg-blue-50/30 dark:bg-blue-950/20'
		: 'border-l-gray-300 dark:border-l-gray-700 opacity-75'}"
>
	<CardContent class="p-3">
		<!-- Header row -->
		<div class="flex items-center justify-between gap-2">
			<div class="flex items-center gap-2 min-w-0 flex-1">
				<!-- Frame index -->
				<span
					class="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-muted text-xs font-mono"
				>
					{index}
				</span>

				<!-- File icon -->
				{#if isLibraryCode}
					<Package class="w-4 h-4 text-muted-foreground flex-shrink-0" />
				{:else}
					<FileCode class="w-4 h-4 text-blue-500 flex-shrink-0" />
				{/if}

				<!-- Function name -->
				<code class="font-mono text-sm truncate font-medium">
					{displayFunction}
				</code>

				<!-- App code badge -->
				{#if frame.isAppCode}
					<Badge variant="outline" class="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
						App
					</Badge>
				{/if}
			</div>

			<!-- Expand button if there's metadata or code context -->
			{#if frame.codeContext || frame.metadata}
				<Button
					variant="ghost"
					size="icon"
					class="h-6 w-6"
					onclick={() => (isExpanded = !isExpanded)}
				>
					{#if isExpanded}
						<ChevronUp class="w-4 h-4" />
					{:else}
						<ChevronDown class="w-4 h-4" />
					{/if}
				</Button>
			{/if}
		</div>

		<!-- Location info -->
		<div class="mt-1 pl-8 flex items-center gap-2 text-xs text-muted-foreground">
			<span class="font-mono truncate">{frame.filePath}</span>
			{#if frame.lineNumber}
				<span class="text-blue-500 font-mono flex-shrink-0">
					:{frame.lineNumber}{#if frame.columnNumber}:{frame.columnNumber}{/if}
				</span>
			{/if}
		</div>

		<!-- Expanded content -->
		{#if isExpanded}
			<div class="mt-3 pl-8 space-y-2">
				<!-- Code context -->
				{#if frame.codeContext}
					<div class="rounded-md bg-muted/50 p-2">
						<div class="flex items-center gap-1 text-xs text-muted-foreground mb-1">
							<Code class="w-3 h-3" />
							<span>Code Context</span>
						</div>
						<pre class="text-xs font-mono overflow-x-auto">{JSON.stringify(frame.codeContext, null, 2)}</pre>
					</div>
				{/if}

				<!-- Metadata -->
				{#if frame.metadata && Object.keys(frame.metadata).length > 0}
					<div class="rounded-md bg-muted/50 p-2">
						<div class="text-xs text-muted-foreground mb-1">Metadata</div>
						<pre class="text-xs font-mono overflow-x-auto">{JSON.stringify(frame.metadata, null, 2)}</pre>
					</div>
				{/if}
			</div>
		{/if}
	</CardContent>
</Card>
