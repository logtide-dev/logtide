<script lang="ts">
	import { onMount } from 'svelte';
	import { layoutStore } from '$lib/stores/layout';
	import { displayPreferences, type DisplayPreferences } from '$lib/stores/display-preferences';
	import { formatTimestamp, getDisplayZoneLabel } from '$lib/utils/datetime';
	import { levelTone } from '$lib/utils/severity';
	import type { LogEntry } from '$lib/api/logs';
	import { computeWindow } from '$lib/components/search/virtual-window';
	import { rowKey } from '$lib/components/search/log-fields';

	interface Props {
		logs: LogEntry[];
		isLiveTail?: boolean;
		maxHeight?: string;
		class?: string;
		/** Row key (`rowKey(log, index)`) of the line shown in the details panel. */
		selectedId?: string | null;
		onSelect?: (log: LogEntry) => void;
		/** Fires when the view reaches or leaves the newest lines (top 50 px). */
		onScrollTopChange?: (atTop: boolean) => void;
	}

	let {
		logs,
		isLiveTail = false,
		maxHeight = '600px',
		class: className = '',
		selectedId = null,
		onSelect,
		onScrollTopChange,
	}: Props = $props();

	/** Fixed line height of the no-wrap mode, used for windowing. */
	const LINE_HEIGHT = 21;
	const AT_TOP_PX = 50;
	// No-wrap lines are one truncated row; nothing past this is ever visible.
	const MAX_LINE_CHARS = 2000;

	const wrapEnabled = $derived($layoutStore.terminalWrapEnabled);

	let containerRef = $state<HTMLDivElement | null>(null);
	let scrollTop = $state(0);
	let viewportHeight = $state(0);
	// Plain variable: the auto-scroll effect must re-run on new logs, not on scrolling.
	let atTop = true;

	const keys = $derived(uniqueKeys(logs));
	const win = $derived(
		wrapEnabled
			? { start: 0, end: logs.length, padTop: 0, padBottom: 0 }
			: computeWindow({ scrollTop, viewportHeight, rowHeight: LINE_HEIGHT, count: logs.length }),
	);
	const visible = $derived(logs.slice(win.start, win.end));
	// Reading the store re-renders the caption when the zone preference changes.
	const zoneLabel = $derived.by(() => {
		$displayPreferences;
		return getDisplayZoneLabel();
	});

	/** Keys for the keyed list; a repeated id gets a suffix instead of breaking the list. */
	function uniqueKeys(list: LogEntry[]): string[] {
		const seen = new Map<string, number>();
		return list.map((log, i) => {
			const base = rowKey(log, i);
			const n = seen.get(base) ?? 0;
			seen.set(base, n + 1);
			return n === 0 ? base : `${base}#${n}`;
		});
	}

	// `_prefs` comes from the template so the line re-renders on a preference change.
	function timeText(time: string, _prefs: DisplayPreferences): string {
		return formatTimestamp(time, { precision: 'ms', withDate: true });
	}

	function levelText(level: unknown): string {
		const text = typeof level === 'string' && level ? level : 'unknown';
		return text.toUpperCase().padEnd(8);
	}

	function messageText(message: unknown, wrap: boolean): string {
		const text = typeof message === 'string' ? message : String(message ?? '');
		if (wrap) return text;
		// One line per log in no-wrap mode, so windowing can assume a fixed height.
		const line = text.length > MAX_LINE_CHARS ? text.slice(0, MAX_LINE_CHARS) : text;
		return line.replace(/\r\n|\r|\n/g, '\\n');
	}

	function measure() {
		if (!containerRef) return;
		viewportHeight = containerRef.clientHeight;
	}

	function syncScroll() {
		if (!containerRef) return;
		scrollTop = containerRef.scrollTop;
		const nowAtTop = scrollTop < AT_TOP_PX;
		if (nowAtTop !== atTop) {
			atTop = nowAtTop;
			onScrollTopChange?.(nowAtTop);
		}
	}

	function handleScroll() {
		measure();
		syncScroll();
	}

	/** Scroll back to the newest lines (new logs are prepended at the top). */
	export function scrollToTop(): void {
		if (!containerRef) return;
		containerRef.scrollTop = 0;
		syncScroll();
	}

	function handleLineKeydown(event: KeyboardEvent, log: LogEntry) {
		if (event.target !== event.currentTarget) return;
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		// Keeps the page-level Enter shortcut from acting on the same key press.
		event.stopPropagation();
		onSelect?.(log);
	}

	// While live and at the top, keep showing the newest lines as they arrive.
	$effect(() => {
		const count = logs.length;
		if (isLiveTail && atTop && containerRef && count > 0) {
			containerRef.scrollTop = 0;
			scrollTop = 0;
		}
	});

	onMount(() => {
		measure();
		const onResize = () => measure();
		window.addEventListener('resize', onResize);
		let observer: ResizeObserver | null = null;
		if (typeof ResizeObserver !== 'undefined' && containerRef) {
			observer = new ResizeObserver(onResize);
			observer.observe(containerRef);
		}
		return () => {
			window.removeEventListener('resize', onResize);
			observer?.disconnect();
		};
	});
</script>

<p class="mb-1 text-right text-xs text-muted-foreground">Times in {zoneLabel}</p>
<div
	bind:this={containerRef}
	onscroll={handleScroll}
	class="terminal-container {wrapEnabled ? 'wrap-enabled' : 'no-wrap'} {className}"
	style="max-height: {maxHeight};"
	role="log"
	aria-live={isLiveTail ? 'polite' : 'off'}
	aria-label="Terminal log viewer"
	tabindex="-1"
>
	{#if logs.length === 0}
		<div class="terminal-empty">
			<span class="terminal-prompt">$</span> No logs to display
		</div>
	{:else}
		{#if win.padTop > 0}
			<div aria-hidden="true" style="height: {win.padTop}px;"></div>
		{/if}
		{#each visible as log, j (keys[win.start + j])}
			{@const key = rowKey(log, win.start + j)}
			{@const selected = selectedId !== null && key === selectedId}
			{@const tone = levelTone(String(log.level ?? ''))}
			<div
				class="terminal-line {selected ? 'is-selected' : ''}"
				role="button"
				tabindex="0"
				aria-current={selected ? 'true' : undefined}
				onclick={() => onSelect?.(log)}
				onkeydown={(e) => handleLineKeydown(e, log)}
			>
				<span class="terminal-timestamp text-muted-foreground">[{timeText(log.time, $displayPreferences)}]</span>
				<span class="terminal-level-badge {tone.text}">[{levelText(log.level)}]</span>
				<span class="terminal-service text-primary-text">[{log.service}]</span>
				<span class="terminal-message {tone.text}">{messageText(log.message, wrapEnabled)}</span>
			</div>
		{/each}
		{#if win.padBottom > 0}
			<div aria-hidden="true" style="height: {win.padBottom}px;"></div>
		{/if}
	{/if}
</div>

<style>
	.terminal-container {
		font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
		font-size: 0.8125rem;
		line-height: 1.6;
		border-radius: 0.5rem;
		padding: 1rem;
		overflow: auto;
		user-select: text;
	}

	/* Light mode */
	.terminal-container {
		background-color: #fafafa;
		color: #18181b;
		border: 1px solid #e4e4e7;
	}

	.terminal-container .terminal-empty {
		color: #71717a;
		padding: 2rem 0;
	}

	.terminal-container .terminal-prompt {
		color: #16a34a;
		margin-right: 0.5rem;
	}

	.terminal-container .terminal-line {
		padding: 0.125rem 0.25rem;
		border-radius: 0.25rem;
		cursor: pointer;
	}

	.terminal-container .terminal-line:focus-visible {
		outline: 2px solid hsl(var(--ring));
		outline-offset: -2px;
	}

	/* Wrap mode (default): every line rendered, off-screen ones skipped by the browser */
	.terminal-container.wrap-enabled .terminal-line {
		white-space: pre-wrap;
		word-break: break-word;
		content-visibility: auto;
		contain-intrinsic-size: auto 21px;
	}

	/* No-wrap mode: fixed-height lines, windowed */
	.terminal-container.no-wrap {
		overflow-x: auto;
	}

	.terminal-container.no-wrap .terminal-line {
		white-space: pre;
		height: 21px;
		line-height: 21px;
		padding-top: 0;
		padding-bottom: 0;
		width: max-content;
		min-width: 100%;
	}

	.terminal-container .terminal-line:hover {
		background-color: #f4f4f5;
	}

	.terminal-container .terminal-line.is-selected {
		background-color: hsl(var(--primary) / 0.12);
	}

	.terminal-container .terminal-level-badge {
		font-weight: 500;
	}

	.terminal-container .terminal-message {
		margin-left: 0.25rem;
	}

	/* Dark mode */
	:global(.dark) .terminal-container {
		background-color: #0a0a0a;
		color: #e4e4e7;
		border-color: #27272a;
	}

	:global(.dark) .terminal-container .terminal-line:hover {
		background-color: #27272a;
	}

	:global(.dark) .terminal-container .terminal-line.is-selected {
		background-color: hsl(var(--primary) / 0.22);
	}

	:global(.dark) .terminal-container .terminal-prompt {
		color: #22c55e;
	}
</style>
