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
	import MapPin from '@lucide/svelte/icons/map-pin';

	interface Props {
		frame: StackFrame;
		index: number;
		expanded?: boolean;
	}

	let { frame, index, expanded = false }: Props = $props();
	let isExpanded = $state(false);
	let showMinified = $state(false);

	$effect(() => {
		isExpanded = expanded;
	});

	const isSourceMapped = $derived(!!frame.originalFile);

	// Display paths: prefer original (source-mapped) when available
	const displayPath = $derived(
		showMinified || !isSourceMapped ? frame.filePath : frame.originalFile!
	);
	const displayLine = $derived(
		showMinified || !isSourceMapped ? frame.lineNumber : frame.originalLine ?? frame.lineNumber
	);
	const displayCol = $derived(
		showMinified || !isSourceMapped ? frame.columnNumber : frame.originalColumn ?? frame.columnNumber
	);
	const displayFunction = $derived(
		showMinified || !isSourceMapped
			? (frame.functionName || '<anonymous>')
			: (frame.originalFunction || frame.functionName || '<anonymous>')
	);

	const fileName = $derived(displayPath.split(/[/\\]/).pop() || displayPath);
	const isLibraryCode = $derived(!frame.isAppCode);

	// Code context from source map (stored as { pre: string[], line: string, post: string[] })
	const codeCtx = $derived(frame.codeContext as { pre?: string[]; line?: string; post?: string[] } | null);
	const hasCodeContext = $derived(codeCtx && (codeCtx.line || (codeCtx.pre && codeCtx.pre.length > 0)));
	const hasExpandableContent = $derived(hasCodeContext || (frame.metadata && Object.keys(frame.metadata).length > 0));
</script>

<Card
	class="border-l-4 {frame.isAppCode
		? 'border-l-info bg-info/5'
		: 'border-l-border opacity-75'}"
>
	<CardContent class="p-3">
		<!-- Header row -->
		<div class="flex items-center justify-between gap-2">
			<div class="flex items-center gap-2 min-w-0 flex-1">
				<span
					class="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-muted text-xs font-mono"
				>
					{index}
				</span>

				{#if isLibraryCode}
					<Package class="w-4 h-4 text-muted-foreground flex-shrink-0" />
				{:else}
					<FileCode class="w-4 h-4 text-info-text flex-shrink-0" />
				{/if}

				<code class="font-mono text-sm truncate font-medium">
					{displayFunction}
				</code>

				{#if frame.isAppCode}
					<Badge variant="outline" class="text-xs bg-info/15 text-info-text border-info/30">
						App
					</Badge>
				{/if}

				{#if isSourceMapped}
					<Badge variant="outline" class="text-xs bg-success/15 text-success-text border-success/30">
						<MapPin class="w-3 h-3 mr-1" />
						Source mapped
					</Badge>
				{/if}
			</div>

			{#if hasExpandableContent || isSourceMapped}
				<Button
					variant="ghost"
					size="icon"
					class="h-6 w-6"
					aria-label={isExpanded ? 'Collapse frame' : 'Expand frame'}
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
			<span class="font-mono truncate">{displayPath}</span>
			{#if displayLine}
				<span class="text-info-text font-mono flex-shrink-0">
					:{displayLine}{#if displayCol}:{displayCol}{/if}
				</span>
			{/if}
			{#if isSourceMapped}
				<button
					class="text-xs text-muted-foreground hover:text-foreground underline cursor-pointer ml-1"
					onclick={() => (showMinified = !showMinified)}
				>
					{showMinified ? 'show original' : 'show minified'}
				</button>
			{/if}
		</div>

		<!-- Expanded content -->
		{#if isExpanded}
			<div class="mt-3 pl-8 space-y-2">
				<!-- Code context (from source map sourcesContent) -->
				{#if hasCodeContext && codeCtx}
					<div class="rounded-md bg-muted/50 overflow-hidden">
						<div class="flex items-center gap-1 text-xs text-muted-foreground px-3 py-1.5 border-b border-border/50">
							<Code class="w-3 h-3" />
							<span>Source</span>
						</div>
						<pre class="text-xs font-mono overflow-x-auto p-2 leading-relaxed">{#each codeCtx.pre ?? [] as codeLine}<span class="text-muted-foreground">{codeLine}
</span>{/each}{#if codeCtx.line}<span class="bg-destructive/15 font-bold inline-block w-full">{codeCtx.line}
</span>{/if}{#each codeCtx.post ?? [] as codeLine}<span class="text-muted-foreground">{codeLine}
</span>{/each}</pre>
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
