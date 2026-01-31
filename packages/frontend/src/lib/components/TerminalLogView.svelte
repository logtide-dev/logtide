<script lang="ts">
	interface LogEntry {
		id?: string;
		time: string;
		service: string;
		level: 'debug' | 'info' | 'warn' | 'error' | 'critical';
		message: string;
		metadata?: Record<string, unknown>;
		traceId?: string;
		projectId: string;
	}

	interface Props {
		logs: LogEntry[];
		isLiveTail?: boolean;
		maxHeight?: string;
		class?: string;
	}

	let { logs, isLiveTail = false, maxHeight = '600px', class: className = '' }: Props = $props();

	let containerRef = $state<HTMLDivElement | null>(null);
	let shouldAutoScroll = $state(true);

	function formatTimestamp(time: string): string {
		const date = new Date(time);
		if (isNaN(date.getTime())) {
			return '[Invalid Date]';
		}
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		const seconds = String(date.getSeconds()).padStart(2, '0');
		const ms = String(date.getMilliseconds()).padStart(3, '0');
		return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
	}

	function getLevelClass(level: LogEntry['level']): string {
		switch (level) {
			case 'critical':
				return 'terminal-level-critical';
			case 'error':
				return 'terminal-level-error';
			case 'warn':
				return 'terminal-level-warn';
			case 'info':
				return 'terminal-level-info';
			case 'debug':
				return 'terminal-level-debug';
			default:
				return 'terminal-level-debug';
		}
	}

	function handleScroll() {
		if (!containerRef) return;
		const { scrollTop, scrollHeight, clientHeight } = containerRef;
		const isAtBottom = scrollHeight - scrollTop - clientHeight < 20;
		shouldAutoScroll = isAtBottom;
	}

	$effect(() => {
		if (isLiveTail && shouldAutoScroll && containerRef && logs.length > 0) {
			containerRef.scrollTop = 0;
		}
	});
</script>

<div
	bind:this={containerRef}
	onscroll={handleScroll}
	class="terminal-container {className}"
	style="max-height: {maxHeight};"
	role="log"
	aria-live={isLiveTail ? 'polite' : 'off'}
	aria-label="Terminal log viewer"
	tabindex="0"
>
	{#if logs.length === 0}
		<div class="terminal-empty">
			<span class="terminal-prompt">$</span> No logs to display
		</div>
	{:else}
		{#each logs as log (log.id ?? `${log.time}-${log.message.slice(0, 50)}`)}
			<div class="terminal-line {getLevelClass(log.level)}" role="article">
				<span class="terminal-timestamp">[{formatTimestamp(log.time)}]</span>
				<span class="terminal-level-badge">[{log.level.toUpperCase().padEnd(8)}]</span>
				<span class="terminal-service">[{log.service}]</span>
				<span class="terminal-message">{log.message}</span>
			</div>
		{/each}
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
		white-space: pre-wrap;
		word-break: break-word;
		padding: 0.125rem 0;
	}

	.terminal-container .terminal-line:hover {
		background-color: #f4f4f5;
	}

	.terminal-container .terminal-timestamp {
		color: #71717a;
	}

	.terminal-container .terminal-level-badge {
		font-weight: 500;
	}

	.terminal-container .terminal-service {
		color: #7c3aed;
	}

	.terminal-container .terminal-message {
		margin-left: 0.25rem;
	}

	/* Light mode level colors */
	.terminal-container .terminal-level-critical .terminal-level-badge,
	.terminal-container .terminal-level-critical .terminal-message {
		color: #dc2626;
	}

	.terminal-container .terminal-level-error .terminal-level-badge,
	.terminal-container .terminal-level-error .terminal-message {
		color: #dc2626;
	}

	.terminal-container .terminal-level-warn .terminal-level-badge,
	.terminal-container .terminal-level-warn .terminal-message {
		color: #d97706;
	}

	.terminal-container .terminal-level-info .terminal-level-badge,
	.terminal-container .terminal-level-info .terminal-message {
		color: #0891b2;
	}

	.terminal-container .terminal-level-debug .terminal-level-badge,
	.terminal-container .terminal-level-debug .terminal-message {
		color: #6b7280;
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

	:global(.dark) .terminal-container .terminal-prompt {
		color: #22c55e;
	}

	:global(.dark) .terminal-container .terminal-service {
		color: #a78bfa;
	}

	/* Dark mode level colors - ANSI style */
	:global(.dark) .terminal-container .terminal-level-critical .terminal-level-badge,
	:global(.dark) .terminal-container .terminal-level-critical .terminal-message {
		color: #f87171;
	}

	:global(.dark) .terminal-container .terminal-level-error .terminal-level-badge,
	:global(.dark) .terminal-container .terminal-level-error .terminal-message {
		color: #ef4444;
	}

	:global(.dark) .terminal-container .terminal-level-warn .terminal-level-badge,
	:global(.dark) .terminal-container .terminal-level-warn .terminal-message {
		color: #fbbf24;
	}

	:global(.dark) .terminal-container .terminal-level-info .terminal-level-badge,
	:global(.dark) .terminal-container .terminal-level-info .terminal-message {
		color: #22d3ee;
	}

	:global(.dark) .terminal-container .terminal-level-debug .terminal-level-badge,
	:global(.dark) .terminal-container .terminal-level-debug .terminal-message {
		color: #6b7280;
	}
</style>
