<script lang="ts">
	import type { IncidentStatus, Severity } from '@logtide/shared';
	import type { IncidentSource } from '$lib/api/incidents';
	import Button from '$lib/components/ui/button/button.svelte';
	import X from '@lucide/svelte/icons/x';
	import FilterMultiSelect from './FilterMultiSelect.svelte';
	import {
		DEFAULT_STATUS_FILTER,
		INCIDENT_SOURCE_LABEL,
		INCIDENT_STATUS_LABEL,
		type InboxAssignee,
		type InboxUrlState,
	} from './incident-model';

	interface Props {
		status: IncidentStatus[] | 'all';
		severity: Severity[];
		source: IncidentSource[];
		assignee: InboxAssignee;
		service?: string;
		technique?: string;
		ruleId?: string;
		onChange: (patch: Partial<InboxUrlState>) => void;
		onReset: () => void;
	}

	let { status, severity, source, assignee, service, technique, ruleId, onChange, onReset }: Props =
		$props();

	const STATUS_ORDER: IncidentStatus[] = ['open', 'investigating', 'resolved', 'false_positive'];
	const statusOptions = STATUS_ORDER.map((s) => ({ value: s, label: INCIDENT_STATUS_LABEL[s] }));
	const sourceOptions = (['sigma', 'alert', 'monitor', 'manual'] as IncidentSource[]).map((s) => ({
		value: s,
		label: INCIDENT_SOURCE_LABEL[s],
	}));
	const severityOptions = (['critical', 'high', 'medium', 'low', 'informational'] as Severity[]).map(
		(s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })
	);
	const assigneeOptions: { value: InboxAssignee; label: string }[] = [
		{ value: 'me', label: 'Me' },
		{ value: 'unassigned', label: 'Unassigned' },
		{ value: 'anyone', label: 'Anyone' },
	];

	const statusSelected = $derived(status === 'all' ? [] : status);

	function onStatusChange(next: string[]) {
		// Nothing or everything selected means no status filter.
		if (next.length === 0 || next.length === STATUS_ORDER.length) onChange({ status: 'all' });
		else onChange({ status: next as IncidentStatus[] });
	}

	const atDefaults = $derived(
		status !== 'all' &&
			status.length === DEFAULT_STATUS_FILTER.length &&
			DEFAULT_STATUS_FILTER.every((s) => status.includes(s)) &&
			severity.length === 0 &&
			source.length === 0 &&
			assignee === 'anyone' &&
			!service &&
			!technique &&
			!ruleId
	);

	const chips = $derived(
		[
			service ? { key: 'service', label: 'Service', value: service } : null,
			technique ? { key: 'technique', label: 'Technique', value: technique } : null,
			ruleId ? { key: 'ruleId', label: 'Rule', value: ruleId } : null,
		].filter((c): c is { key: 'service' | 'technique' | 'ruleId'; label: string; value: string } => c !== null)
	);
</script>

<div class="flex flex-wrap items-center gap-2" data-testid="incident-filter-bar">
	<div class="grid w-full grid-cols-1 gap-2 min-[480px]:grid-cols-3 md:contents">
	<FilterMultiSelect
		label="Status"
		options={statusOptions}
		selected={statusSelected}
		emptyLabel="All"
		onChange={onStatusChange}
	/>
	<FilterMultiSelect
		label="Source"
		options={sourceOptions}
		selected={source}
		onChange={(next) => onChange({ source: next as IncidentSource[] })}
	/>
	<FilterMultiSelect
		label="Severity"
		options={severityOptions}
		selected={severity}
		onChange={(next) => onChange({ severity: next as Severity[] })}
	/>
	</div>

	<div role="group" aria-label="Assignee" class="inline-flex rounded-md border p-0.5 max-md:w-full">
		{#each assigneeOptions as option (option.value)}
			<button
				type="button"
				aria-pressed={assignee === option.value}
				class="rounded px-2.5 py-1 text-xs font-medium max-md:h-9 max-md:flex-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {assignee ===
				option.value
					? 'bg-primary text-primary-foreground'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => onChange({ assignee: option.value })}
			>
				{option.label}
			</button>
		{/each}
	</div>

	{#each chips as chip (chip.key)}
		<span class="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-0.5 text-xs">
			<span class="text-muted-foreground">{chip.label}:</span>
			<span class="max-w-[12rem] truncate">{chip.value}</span>
			<button
				type="button"
				class="rounded-full p-0.5 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				aria-label="Remove {chip.label.toLowerCase()} filter"
				onclick={() => onChange({ [chip.key]: undefined })}
			>
				<X class="size-3" aria-hidden="true" />
			</button>
		</span>
	{/each}

	{#if !atDefaults}
		<Button variant="ghost" size="sm" onclick={onReset}>Reset filters</Button>
	{/if}
</div>
