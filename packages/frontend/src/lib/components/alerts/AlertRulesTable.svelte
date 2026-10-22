<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { AlertHistory, AlertRule } from '$lib/api/alerts';
	import DataTable from '$lib/components/app/DataTable.svelte';
	import Timestamp from '$lib/components/app/Timestamp.svelte';
	import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
	import type { DataTableColumn } from '$lib/components/app/data-table';
	import WillNotify from '$lib/components/notification-channels/WillNotify.svelte';
	import SnoozeMenu from '$lib/components/alerts/SnoozeMenu.svelte';
	import { countTriggers24h, deriveRuleState } from '$lib/components/alerts/alert-model';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Switch } from '$lib/components/ui/switch';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Copy from '@lucide/svelte/icons/copy';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	interface Props {
		rules: AlertRule[];
		history: AlertHistory[];
		projectNames: Record<string, string>;
		/** Display label per channel id, for example "Slack: #ops". */
		channelNames: Record<string, string>;
		loading: boolean;
		busyIds: string[];
		onToggle: (rule: AlertRule) => void;
		onEdit: (rule: AlertRule) => void;
		onDuplicate: (rule: AlertRule) => void;
		onDelete: (rule: AlertRule) => void;
		onSnooze: (rule: AlertRule, untilIso: string) => void;
		onUnsnooze: (rule: AlertRule) => void;
		/** Rule to mark as the target of a deep link (`?rule=<id>`). */
		highlightRuleId?: string | null;
		empty?: Snippet;
	}

	let {
		rules,
		history,
		projectNames,
		channelNames,
		loading,
		busyIds,
		onToggle,
		onEdit,
		onDuplicate,
		onDelete,
		onSnooze,
		onUnsnooze,
		highlightRuleId = null,
		empty,
	}: Props = $props();

	const isBusy = (r: AlertRule) => busyIds.includes(r.id);

	function scopeLabel(r: AlertRule): string {
		if (!r.projectId) return 'All projects';
		return projectNames[r.projectId] ?? 'Unknown project';
	}

	function channelSummary(r: AlertRule): string {
		const ids = r.channelIds ?? [];
		const names = ids.map((id) => channelNames[id]).filter((n): n is string => !!n);
		if (names.length > 0) return names.join(', ');
		return `${ids.length.toLocaleString('en-US')} ${ids.length === 1 ? 'channel' : 'channels'}`;
	}

	// Snippets declared in the template are typed loosely by svelte-check.
	const asCell = (s: unknown) => s as Snippet<[AlertRule]>;

	const columns: DataTableColumn<AlertRule>[] = [
		{ key: 'name', header: 'Name', class: 'min-w-[12rem]', cell: asCell(nameCell) },
		{ key: 'scope', header: 'Scope', cell: asCell(scopeCell) },
		{ key: 'state', header: 'State', cell: asCell(stateCell) },
		{ key: 'lastTriggered', header: 'Last triggered', cell: asCell(lastTriggeredCell) },
		{ key: 'triggers', header: 'Triggers (24 h)', cell: asCell(triggersCell) },
		{ key: 'notify', header: 'Will notify', class: 'min-w-[12rem]', cell: asCell(notifyCell) },
		{ key: 'enabled', header: 'Enabled', cell: asCell(enabledCell) },
		{ key: 'actions', header: 'Actions', cell: asCell(actionsCell) },
	];
</script>

{#snippet nameCell(r: AlertRule)}
	<span class="inline-flex items-center gap-2">
		<span class="font-medium" data-rule-id={r.id}>{r.name}</span>
		{#if r.alertType === 'rate_of_change'}
			<span class="rounded border bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">Anomaly</span>
		{/if}
	</span>
{/snippet}

{#snippet scopeCell(r: AlertRule)}
	<span class={r.projectId ? '' : 'text-muted-foreground'}>{scopeLabel(r)}</span>
{/snippet}

{#snippet stateCell(r: AlertRule)}
	{@const state = deriveRuleState(r)}
	<span class="inline-flex flex-col items-start gap-0.5">
		<SeverityBadge kind="state" value={state} />
		{#if state === 'snoozed' && r.snoozedUntil}
			<span class="text-xs text-muted-foreground">
				until <Timestamp value={r.snoozedUntil} precision="minute" showZone />
			</span>
		{/if}
	</span>
{/snippet}

{#snippet lastTriggeredCell(r: AlertRule)}
	{#if r.lastTriggeredAt}
		<Timestamp value={r.lastTriggeredAt} precision="minute" showZone />
	{:else}
		<span class="text-muted-foreground">-</span>
	{/if}
{/snippet}

{#snippet triggersCell(r: AlertRule)}
	<span class="tabular-nums">{countTriggers24h(r, history).toLocaleString('en-US')}</span>
{/snippet}

{#snippet notifyCell(r: AlertRule)}
	{#if (r.channelIds ?? []).length > 0}
		<span class="text-sm text-muted-foreground" data-testid="notify-summary">{channelSummary(r)}</span>
	{:else}
		<WillNotify eventType="alert" projectId={r.projectId} />
	{/if}
{/snippet}

{#snippet enabledCell(r: AlertRule)}
	<Switch
		checked={r.enabled}
		disabled={isBusy(r)}
		aria-label="{r.enabled ? 'Disable' : 'Enable'} {r.name}"
		onCheckedChange={() => onToggle(r)}
	/>
{/snippet}

{#snippet actionsCell(r: AlertRule)}
	<span class="inline-flex items-center">
		<Button
			variant="ghost"
			size="icon"
			class="h-8 w-8"
			aria-label="Edit alert {r.name}"
			disabled={isBusy(r)}
			onclick={() => onEdit(r)}
		>
			<Pencil class="h-4 w-4" aria-hidden="true" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="h-8 w-8"
			aria-label="Duplicate alert {r.name}"
			disabled={isBusy(r)}
			onclick={() => onDuplicate(r)}
		>
			<Copy class="h-4 w-4" aria-hidden="true" />
		</Button>
		<SnoozeMenu
			rule={r}
			busy={isBusy(r)}
			onSnooze={(until) => onSnooze(r, until)}
			onUnsnooze={() => onUnsnooze(r)}
		/>
		<Button
			variant="ghost"
			size="icon"
			class="h-8 w-8"
			aria-label="Delete alert {r.name}"
			disabled={isBusy(r)}
			onclick={() => onDelete(r)}
		>
			<Trash2 class="h-4 w-4 text-destructive-text" aria-hidden="true" />
		</Button>
	</span>
{/snippet}

<DataTable
	{columns}
	rows={rules}
	rowKey={(r: AlertRule) => r.id}
	selected={highlightRuleId ? [highlightRuleId] : []}
	{loading}
	{empty}
/>
