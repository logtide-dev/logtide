<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { DetectionEvent } from '@logtide/shared';
	import type { AlertHistory, AlertRule } from '$lib/api/alerts';
	import DataTable from '$lib/components/app/DataTable.svelte';
	import Timestamp from '$lib/components/app/Timestamp.svelte';
	import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
	import type { DataTableColumn } from '$lib/components/app/data-table';
	import { buildMatchedLogsUrl } from '$lib/components/alerts/alert-model';
	import { buildTraceUrl } from '$lib/components/siem/incidents/incident-model';
	import { stateTone } from '$lib/utils/severity';
	import Button from '$lib/components/ui/button/button.svelte';

	interface Props {
		alerts: AlertHistory[];
		detections: DetectionEvent[];
		rules: AlertRule[];
		projectNames: Record<string, string>;
		loading: boolean;
		hasMore: boolean;
		onLoadMore: () => void;
		empty?: Snippet;
	}

	let { alerts, detections, rules, projectNames, loading, hasMore, onLoadMore, empty }: Props =
		$props();

	type Row =
		| { kind: 'alert'; key: string; at: number; data: AlertHistory }
		| { kind: 'detection'; key: string; at: number; data: DetectionEvent };

	const toMs = (v: string | Date) => {
		const t = new Date(v).getTime();
		return Number.isNaN(t) ? 0 : t;
	};

	const rows = $derived<Row[]>(
		[
			...alerts.map((a): Row => ({ kind: 'alert', key: `a:${a.id}`, at: toMs(a.triggeredAt), data: a })),
			...detections.map(
				(d): Row => ({ kind: 'detection', key: `d:${d.id}`, at: toMs(d.time), data: d })
			),
		].sort((a, b) => b.at - a.at)
	);

	const ruleById = $derived(new Map(rules.map((r) => [r.id, r])));

	let expandedErrors = $state<Set<string>>(new Set());

	function toggleError(key: string) {
		const next = new Set(expandedErrors);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		expandedErrors = next;
	}

	const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

	function sourceLabel(r: Row): string {
		if (r.kind === 'detection') return capitalize(r.data.category);
		return r.data.alertType === 'rate_of_change' ? 'Anomaly' : 'Alert';
	}

	function nameOf(r: Row): string {
		return r.kind === 'alert' ? r.data.ruleName : r.data.ruleTitle;
	}

	function projectOf(r: Row): string {
		const id = r.data.projectId;
		if (!id) return 'All projects';
		if (r.kind === 'alert' && r.data.projectName) return r.data.projectName;
		return projectNames[id] ?? 'Unknown project';
	}

	/** Full criteria of the rule when it still exists, else the fields the history row carries. */
	function matchedLogsHref(h: AlertHistory): string {
		const rule = ruleById.get(h.ruleId);
		return buildMatchedLogsUrl({
			projectId: rule ? rule.projectId : h.projectId,
			query: rule ? rule.query : h.query,
			service: rule ? rule.service : h.service,
			levels: rule ? rule.level : h.level,
			metadataFilters: rule ? rule.metadataFilters : h.metadataFilters,
			triggeredAt: h.triggeredAt,
			windowMinutes: h.timeWindow,
		});
	}

	function logHref(d: DetectionEvent): string {
		const project = d.projectId ? `&project=${encodeURIComponent(d.projectId)}` : '';
		return `/dashboard/logs?logId=${encodeURIComponent(d.logId)}${project}`;
	}

	// Snippets declared in the template are typed loosely by svelte-check.
	const asCell = (s: unknown) => s as Snippet<[Row]>;

	const columns: DataTableColumn<Row>[] = [
		{ key: 'time', header: 'Time', cell: asCell(timeCell) },
		{ key: 'source', header: 'Source', cell: asCell(sourceCell) },
		{ key: 'name', header: 'Name', class: 'min-w-[12rem]', cell: asCell(nameCell) },
		{ key: 'project', header: 'Project', cell: asCell(projectCell) },
		{ key: 'result', header: 'Result', cell: asCell(resultCell) },
		{ key: 'links', header: 'Links', cell: asCell(linksCell) },
	];
</script>

{#snippet timeCell(r: Row)}
	<Timestamp value={r.kind === 'alert' ? r.data.triggeredAt : r.data.time} showZone />
{/snippet}

{#snippet sourceCell(r: Row)}
	<span class="rounded border bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">{sourceLabel(r)}</span>
{/snippet}

{#snippet nameCell(r: Row)}
	<span class="font-medium">{nameOf(r)}</span>
{/snippet}

{#snippet projectCell(r: Row)}
	<span class={r.data.projectId ? '' : 'text-muted-foreground'}>{projectOf(r)}</span>
{/snippet}

{#snippet resultCell(r: Row)}
	{#if r.kind === 'detection'}
		<SeverityBadge kind="severity" value={r.data.severity} />
	{:else if r.data.notified}
		{@const tone = stateTone('ok')}
		<span class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium {tone.badge}" data-testid="result-notified">
			<span class="size-1.5 rounded-full {tone.dot}" aria-hidden="true"></span>
			Notified
		</span>
	{:else if r.data.error}
		{@const tone = stateTone('failed')}
		<span class="inline-flex flex-col items-start gap-1">
			<span class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium {tone.badge}" data-testid="result-failed">
				<span class="size-1.5 rounded-full {tone.dot}" aria-hidden="true"></span>
				Failed
			</span>
			<button
				type="button"
				class="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
				aria-expanded={expandedErrors.has(r.key)}
				onclick={() => toggleError(r.key)}
			>
				{expandedErrors.has(r.key) ? 'Hide error' : 'Show error'}
			</button>
			{#if expandedErrors.has(r.key)}
				<span class="max-w-xs break-all font-mono text-xs text-destructive-text">{r.data.error}</span>
			{/if}
		</span>
	{:else}
		{@const tone = stateTone('pending')}
		<span class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium {tone.badge}" data-testid="result-pending">
			<span class="size-1.5 rounded-full {tone.dot}" aria-hidden="true"></span>
			Pending
		</span>
	{/if}
{/snippet}

{#snippet linksCell(r: Row)}
	<span class="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
		{#if r.kind === 'alert'}
			<a class="text-primary hover:underline" href={matchedLogsHref(r.data)}>Show matched logs</a>
			{#if ruleById.has(r.data.ruleId)}
				<a class="text-primary hover:underline" href="/dashboard/alerts?edit={encodeURIComponent(r.data.ruleId)}">View rule</a>
			{/if}
		{:else}
			<a class="text-primary hover:underline" href={logHref(r.data)}>Open log</a>
			<a class="text-primary hover:underline" href="/dashboard/security/rules/{encodeURIComponent(r.data.sigmaRuleId)}">View rule</a>
			{#if r.data.traceId}
				<a class="font-mono text-xs text-primary hover:underline" href={buildTraceUrl(r.data.traceId, r.data.projectId)}>
					{r.data.traceId.slice(0, 8)}
				</a>
			{/if}
		{/if}
	</span>
{/snippet}

<div class="space-y-3">
	<DataTable {columns} {rows} rowKey={(r: Row) => r.key} {loading} {empty} />
	{#if hasMore}
		<div class="flex justify-center">
			<Button type="button" variant="outline" disabled={loading} onclick={onLoadMore}>Load more</Button>
		</div>
	{/if}
</div>
