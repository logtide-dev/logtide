<script lang="ts">
	import Button from '$lib/components/ui/button/button.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import Input from '$lib/components/ui/input/input.svelte';
	import * as Popover from '$lib/components/ui/popover';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import Label from '$lib/components/ui/label/label.svelte';
	import type { IncidentStatus, Severity } from '$lib/api/siem';
	import X from '@lucide/svelte/icons/x';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Server from '@lucide/svelte/icons/server';
	import Shield from '@lucide/svelte/icons/shield';

	interface Props {
		statusFilter: IncidentStatus[];
		severityFilter: Severity[];
		serviceFilter: string;
		techniqueFilter: string;
		onStatusChange: (statuses: IncidentStatus[]) => void;
		onSeverityChange: (severities: Severity[]) => void;
		onServiceChange: (service: string) => void;
		onTechniqueChange: (technique: string) => void;
		onReset: () => void;
	}

	let {
		statusFilter,
		severityFilter,
		serviceFilter,
		techniqueFilter,
		onStatusChange,
		onSeverityChange,
		onServiceChange,
		onTechniqueChange,
		onReset,
	}: Props = $props();

	const statuses: { value: IncidentStatus; label: string }[] = [
		{ value: 'open', label: 'Open' },
		{ value: 'investigating', label: 'Investigating' },
		{ value: 'resolved', label: 'Resolved' },
		{ value: 'false_positive', label: 'False Positive' },
	];

	const severities: { value: Severity; label: string; color: string }[] = [
		{ value: 'critical', label: 'Critical', color: 'bg-purple-500' },
		{ value: 'high', label: 'High', color: 'bg-red-500' },
		{ value: 'medium', label: 'Medium', color: 'bg-orange-500' },
		{ value: 'low', label: 'Low', color: 'bg-yellow-500' },
		{ value: 'informational', label: 'Info', color: 'bg-blue-500' },
	];

	function toggleStatus(status: IncidentStatus) {
		if (statusFilter.includes(status)) {
			onStatusChange(statusFilter.filter((s) => s !== status));
		} else {
			onStatusChange([...statusFilter, status]);
		}
	}

	function toggleSeverity(severity: Severity) {
		if (severityFilter.includes(severity)) {
			onSeverityChange(severityFilter.filter((s) => s !== severity));
		} else {
			onSeverityChange([...severityFilter, severity]);
		}
	}

	const activeFiltersCount = $derived(
		statusFilter.length +
			severityFilter.length +
			(serviceFilter ? 1 : 0) +
			(techniqueFilter ? 1 : 0)
	);
</script>

<div class="flex items-center gap-2 flex-wrap">
	<!-- Status Filter -->
	<Popover.Root>
		<Popover.Trigger>
			<Button variant="outline" size="sm" class="gap-2">
				Status
				{#if statusFilter.length > 0}
					<Badge variant="secondary" class="ml-1">{statusFilter.length}</Badge>
				{/if}
				<ChevronDown class="w-4 h-4" />
			</Button>
		</Popover.Trigger>
		<Popover.Content class="w-56 p-3">
			<div class="space-y-2">
				<p class="text-sm font-medium mb-2">Filter by status</p>
				{#each statuses as status}
					<div class="flex items-center space-x-2">
						<Checkbox
							id="status-{status.value}"
							checked={statusFilter.includes(status.value)}
							onCheckedChange={() => toggleStatus(status.value)}
						/>
						<Label for="status-{status.value}" class="text-sm cursor-pointer">
							{status.label}
						</Label>
					</div>
				{/each}
			</div>
		</Popover.Content>
	</Popover.Root>

	<!-- Severity Filter -->
	<Popover.Root>
		<Popover.Trigger>
			<Button variant="outline" size="sm" class="gap-2">
				Severity
				{#if severityFilter.length > 0}
					<Badge variant="secondary" class="ml-1">{severityFilter.length}</Badge>
				{/if}
				<ChevronDown class="w-4 h-4" />
			</Button>
		</Popover.Trigger>
		<Popover.Content class="w-56 p-3">
			<div class="space-y-2">
				<p class="text-sm font-medium mb-2">Filter by severity</p>
				{#each severities as severity}
					<div class="flex items-center space-x-2">
						<Checkbox
							id="severity-{severity.value}"
							checked={severityFilter.includes(severity.value)}
							onCheckedChange={() => toggleSeverity(severity.value)}
						/>
						<Label for="severity-{severity.value}" class="text-sm cursor-pointer flex items-center gap-2">
							<span class="w-2 h-2 rounded-full {severity.color}"></span>
							{severity.label}
						</Label>
					</div>
				{/each}
			</div>
		</Popover.Content>
	</Popover.Root>

	<!-- Service Filter -->
	<div class="flex items-center gap-1">
		<Server class="w-4 h-4 text-muted-foreground" />
		<Input
			type="text"
			placeholder="Filter by service..."
			value={serviceFilter}
			oninput={(e) => onServiceChange(e.currentTarget.value)}
			class="h-8 w-40 text-sm"
		/>
	</div>

	<!-- Technique Filter -->
	<div class="flex items-center gap-1">
		<Shield class="w-4 h-4 text-muted-foreground" />
		<Input
			type="text"
			placeholder="MITRE technique (T1021)..."
			value={techniqueFilter}
			oninput={(e) => onTechniqueChange(e.currentTarget.value)}
			class="h-8 w-44 text-sm"
		/>
	</div>

	<!-- Reset Button -->
	{#if activeFiltersCount > 0}
		<Button variant="ghost" size="sm" onclick={onReset} class="gap-1">
			<X class="w-4 h-4" />
			Clear filters ({activeFiltersCount})
		</Button>
	{/if}
</div>
