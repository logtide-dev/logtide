<script lang="ts">
	import { untrack } from 'svelte';
	import type {
		AlertBuilderPrefill,
		AlertType,
		BaselineType,
		CreateAlertRuleInput,
		PreviewSuggestion,
	} from '$lib/api/alerts';
	import type { LogLevel, MetadataFilterInput } from '@logtide/shared';
	import MetadataFilterBuilder from '$lib/components/alerts/MetadataFilterBuilder.svelte';
	import AlertPreview from '$lib/components/alerts/AlertPreview.svelte';
	import { validateAlertQuery } from '$lib/components/alerts/alert-model';
	import { ChannelSelector } from '$lib/components/notification-channels';
	import WillNotify from '$lib/components/notification-channels/WillNotify.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import Eye from '@lucide/svelte/icons/eye';
	import Bell from '@lucide/svelte/icons/bell';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import TrendingUp from '@lucide/svelte/icons/trending-up';

	interface Props {
		mode: 'create' | 'edit';
		organizationId: string;
		projects: { id: string; name: string }[];
		initial?: AlertBuilderPrefill & { projectId?: string | null };
		/** Set on the project tab: the scope is fixed and read-only. */
		lockedProjectId?: string | null;
		submitting: boolean;
		onSubmit: (input: Omit<CreateAlertRuleInput, 'organizationId'>) => void;
		onCancel: () => void;
		submitLabel: string;
	}

	let {
		mode,
		organizationId,
		projects,
		initial,
		lockedProjectId = null,
		submitting,
		onSubmit,
		onCancel,
		submitLabel,
	}: Props = $props();

	const LEVELS = ['debug', 'info', 'warn', 'error', 'critical'] as const;

	const BASELINE_OPTIONS: { value: BaselineType; label: string; desc: string }[] = [
		{ value: 'rolling_7d_avg', label: '7-day rolling avg', desc: 'Average of the same hour over the last 7 days' },
		{ value: 'same_time_yesterday', label: 'Same time yesterday', desc: 'Compare with the same hour yesterday' },
		{ value: 'same_day_last_week', label: 'Same day last week', desc: 'Compare with the same day and hour last week' },
		{ value: 'percentile_p95', label: '95th percentile (7d)', desc: '95th percentile of hourly rates over 7 days' },
	];

	const RENOTIFY_OPTIONS: { value: string; label: string }[] = [
		{ value: '', label: 'Never' },
		{ value: '15', label: 'Every 15 minutes' },
		{ value: '30', label: 'Every 30 minutes' },
		{ value: '60', label: 'Every 1 hour' },
		{ value: '240', label: 'Every 4 hours' },
		{ value: '1440', label: 'Every 24 hours' },
	];

	const SELECT_CLASS =
		'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

	// Initial values are read once: the dialogs remount the form on every open.
	const seed = untrack(() => initial ?? {});
	const lockedAtMount = untrack(() => lockedProjectId);
	let name = $state(seed.name ?? '');
	let service = $state(seed.service ?? '');
	let query = $state(seed.query ?? '');
	let selectedLevels = $state<string[]>(
		seed.levels && seed.levels.length > 0 ? [...seed.levels] : ['error', 'critical']
	);
	let threshold = $state(seed.threshold ?? 10);
	let timeWindow = $state(seed.timeWindow ?? 5);
	let selectedChannelIds = $state<string[]>(seed.channelIds ? [...seed.channelIds] : []);
	let metadataFilters = $state<MetadataFilterInput[]>(seed.metadataFilters ? [...seed.metadataFilters] : []);
	let projectChoice = $state<string>(lockedAtMount ?? seed.projectId ?? '');
	let renotify = $state<string>(seed.renotifyMinutes != null ? String(seed.renotifyMinutes) : '');

	let alertType = $state<AlertType>(seed.alertType ?? 'threshold');
	let baselineType = $state<BaselineType>(seed.baselineType ?? 'rolling_7d_avg');
	let deviationMultiplier = $state(seed.deviationMultiplier ?? 3);
	let minBaselineValue = $state(seed.minBaselineValue ?? 10);
	let cooldownMinutes = $state(seed.cooldownMinutes ?? 60);
	let sustainedMinutes = $state(seed.sustainedMinutes ?? 5);
	let showAdvanced = $state(false);

	let showPreview = $state(false);
	let errors = $state<Record<string, string>>({});

	const isThreshold = $derived(alertType === 'threshold');
	const effectiveProjectId = $derived(lockedProjectId ?? (projectChoice || null));
	const trimmedQuery = $derived(query.trim());
	const queryCheck = $derived(
		isThreshold && trimmedQuery ? validateAlertQuery(trimmedQuery) : ({ ok: true } as const)
	);
	const queryError = $derived(
		queryCheck.ok ? null : `${queryCheck.message} (position ${queryCheck.position})`
	);
	const scopeName = $derived.by(() => {
		const id = lockedProjectId ?? seed.projectId ?? null;
		if (!id) return 'All projects';
		return projects.find((p) => p.id === id)?.name ?? 'Unknown project';
	});
	const canPreview = $derived(
		isThreshold &&
			selectedLevels.length > 0 &&
			threshold >= 1 &&
			timeWindow >= 1 &&
			queryCheck.ok
	);
	const cleanFilters = $derived(metadataFilters.filter((f) => f.key.trim().length > 0));

	function toggleLevel(level: string) {
		selectedLevels = selectedLevels.includes(level)
			? selectedLevels.filter((l) => l !== level)
			: [...selectedLevels, level];
	}

	function handleSuggestionApply(suggestion: PreviewSuggestion) {
		if (suggestion.recommendedValue !== undefined) threshold = suggestion.recommendedValue;
		showPreview = false;
	}

	function validate(): Record<string, string> {
		const next: Record<string, string> = {};
		if (!name.trim()) next.name = 'Enter an alert name';
		if (selectedLevels.length === 0) next.levels = 'Select at least one log level';
		if (isThreshold) {
			if (threshold < 1) next.threshold = 'Threshold must be at least 1';
			if (timeWindow < 1) next.timeWindow = 'Time window must be at least 1 minute';
			if (queryError) next.query = queryError;
		} else if (deviationMultiplier < 1.5 || deviationMultiplier > 20) {
			next.deviation = 'Deviation multiplier must be between 1.5 and 20';
		}
		if (selectedChannelIds.length === 0) next.channels = 'Select at least one channel';
		return next;
	}

	function handleSubmit(e: Event) {
		e.preventDefault();
		errors = validate();
		if (Object.keys(errors).length > 0) return;

		const input: Omit<CreateAlertRuleInput, 'organizationId'> = {
			projectId: effectiveProjectId,
			name: name.trim(),
			enabled: true,
			service: service.trim() || null,
			level: [...selectedLevels] as LogLevel[],
			threshold: isThreshold ? threshold : 1,
			timeWindow: isThreshold ? timeWindow : 60,
			alertType,
			channelIds: selectedChannelIds,
			metadataFilters: cleanFilters,
		};

		if (isThreshold) {
			input.query = trimmedQuery || null;
			input.renotifyMinutes = renotify ? Number(renotify) : null;
		} else {
			input.baselineType = baselineType;
			input.deviationMultiplier = deviationMultiplier;
			input.minBaselineValue = minBaselineValue;
			input.cooldownMinutes = cooldownMinutes;
			input.sustainedMinutes = sustainedMinutes;
		}

		onSubmit(input);
	}
</script>

<form class="space-y-4" onsubmit={handleSubmit} novalidate>
	<div class="space-y-2">
		<Label>Alert type</Label>
		<div class="grid grid-cols-2 gap-2">
			<button
				type="button"
				aria-pressed={isThreshold}
				class="flex items-center gap-2 p-3 rounded-lg border-2 text-left transition-colors {isThreshold ? 'border-primary bg-primary/5' : 'border-muted hover:border-muted-foreground/30'}"
				onclick={() => (alertType = 'threshold')}
				disabled={submitting}
			>
				<Bell class="w-5 h-5 {isThreshold ? 'text-primary' : 'text-muted-foreground'}" />
				<div>
					<div class="font-medium text-sm">Threshold</div>
					<div class="text-xs text-muted-foreground">Fixed log count limit</div>
				</div>
			</button>
			<button
				type="button"
				aria-pressed={!isThreshold}
				class="flex items-center gap-2 p-3 rounded-lg border-2 text-left transition-colors {!isThreshold ? 'border-primary bg-primary/5' : 'border-muted hover:border-muted-foreground/30'}"
				onclick={() => (alertType = 'rate_of_change')}
				disabled={submitting}
			>
				<TrendingUp class="w-5 h-5 {!isThreshold ? 'text-primary' : 'text-muted-foreground'}" />
				<div>
					<div class="font-medium text-sm">Rate of change</div>
					<div class="text-xs text-muted-foreground">Anomaly vs baseline</div>
				</div>
			</button>
		</div>
	</div>

	<div class="space-y-2">
		<Label for="alert-name">Alert name</Label>
		<Input
			id="alert-name"
			type="text"
			placeholder={isThreshold ? 'High error rate' : 'Error rate anomaly'}
			bind:value={name}
			disabled={submitting}
			aria-invalid={errors.name ? 'true' : undefined}
		/>
		{#if errors.name}<p class="text-xs text-destructive-text" role="alert">{errors.name}</p>{/if}
	</div>

	<div class="space-y-2">
		{#if lockedProjectId || mode === 'edit'}
			<Label>Scope</Label>
			<p class="text-sm" data-testid="scope-readonly">{scopeName}</p>
			{#if mode === 'edit'}
				<p class="text-xs text-muted-foreground">Scope cannot be changed after creation</p>
			{/if}
		{:else}
			<Label for="alert-scope">Scope</Label>
			<select id="alert-scope" class={SELECT_CLASS} bind:value={projectChoice} disabled={submitting}>
				<option value="">All projects</option>
				{#each projects as p (p.id)}
					<option value={p.id}>{p.name}</option>
				{/each}
			</select>
		{/if}
	</div>

	<div class="space-y-2">
		<Label for="alert-service">Service</Label>
		<Input
			id="alert-service"
			type="text"
			placeholder="Leave empty to monitor all services"
			bind:value={service}
			disabled={submitting}
		/>
		<p class="text-xs text-muted-foreground">Optional. Filter logs by service name.</p>
	</div>

	<div class="space-y-2">
		<Label for="alert-query">Query</Label>
		<Input
			id="alert-query"
			type="text"
			placeholder="timeout OR refused"
			bind:value={query}
			disabled={submitting || !isThreshold}
			aria-invalid={queryError ? 'true' : undefined}
			class="font-mono"
		/>
		{#if !isThreshold}
			<p class="text-xs text-muted-foreground">Text queries apply to threshold rules only</p>
		{:else}
			<p class="text-xs text-muted-foreground">Search syntax: level:error service:api</p>
		{/if}
		{#if queryError}<p class="text-xs text-destructive-text" role="alert">{queryError}</p>{/if}
	</div>

	<div class="space-y-2">
		<Label id="alert-levels-label">Log levels</Label>
		<div class="flex flex-wrap gap-2" role="group" aria-labelledby="alert-levels-label">
			{#each LEVELS as level (level)}
				<Button
					type="button"
					variant={selectedLevels.includes(level) ? 'default' : 'outline'}
					size="sm"
					aria-pressed={selectedLevels.includes(level)}
					onclick={() => toggleLevel(level)}
					disabled={submitting}
				>
					{level}
				</Button>
			{/each}
		</div>
		{#if errors.levels}<p class="text-xs text-destructive-text" role="alert">{errors.levels}</p>{/if}
	</div>

	<div class="space-y-2">
		<Label>Metadata filters</Label>
		<MetadataFilterBuilder bind:filters={metadataFilters} disabled={submitting} />
		<p class="text-xs text-muted-foreground">Only alert on logs matching these metadata conditions. Optional.</p>
	</div>

	{#if isThreshold}
		<div class="grid grid-cols-2 gap-4">
			<div class="space-y-2">
				<Label for="alert-threshold">Threshold</Label>
				<Input id="alert-threshold" type="number" min="1" bind:value={threshold} disabled={submitting} />
				<p class="text-xs text-muted-foreground">Number of logs</p>
				{#if errors.threshold}<p class="text-xs text-destructive-text" role="alert">{errors.threshold}</p>{/if}
			</div>
			<div class="space-y-2">
				<Label for="alert-window">Time window</Label>
				<Input id="alert-window" type="number" min="1" bind:value={timeWindow} disabled={submitting} />
				<p class="text-xs text-muted-foreground">Minutes</p>
				{#if errors.timeWindow}<p class="text-xs text-destructive-text" role="alert">{errors.timeWindow}</p>{/if}
			</div>
		</div>

		<div class="p-3 bg-muted rounded-md text-sm">
			Alert triggers when <strong>{threshold}</strong> or more logs matching the criteria are received within
			<strong>{timeWindow}</strong>
			minute{timeWindow > 1 ? 's' : ''}
		</div>

		<div class="space-y-2">
			<Label for="alert-renotify">Renotify</Label>
			<select
				id="alert-renotify"
				class={SELECT_CLASS}
				bind:value={renotify}
				disabled={submitting}
			>
				{#each RENOTIFY_OPTIONS as opt (opt.value)}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
			<p class="text-xs text-muted-foreground">Send another notification while the alert keeps firing</p>
		</div>
	{:else}
		<div class="space-y-4">
			<div class="space-y-2">
				<Label>Baseline method</Label>
				<div class="grid grid-cols-2 gap-2">
					{#each BASELINE_OPTIONS as opt (opt.value)}
						<button
							type="button"
							aria-pressed={baselineType === opt.value}
							class="p-2.5 rounded-lg border text-left transition-colors {baselineType === opt.value ? 'border-primary bg-primary/5' : 'border-muted hover:border-muted-foreground/30'}"
							onclick={() => (baselineType = opt.value)}
							disabled={submitting}
						>
							<div class="font-medium text-sm">{opt.label}</div>
							<div class="text-xs text-muted-foreground">{opt.desc}</div>
						</button>
					{/each}
				</div>
			</div>

			<div class="space-y-2">
				<Label for="alert-deviation">Deviation multiplier</Label>
				<Input
					id="alert-deviation"
					type="number"
					min="1.5"
					max="20"
					step="0.5"
					bind:value={deviationMultiplier}
					disabled={submitting}
				/>
				<p class="text-xs text-muted-foreground">
					Alert when the current rate exceeds the baseline by this factor (3x means 200% above normal)
				</p>
				{#if errors.deviation}<p class="text-xs text-destructive-text" role="alert">{errors.deviation}</p>{/if}
			</div>

			<div class="border rounded-lg">
				<button
					type="button"
					class="flex items-center justify-between w-full p-3 text-sm font-medium hover:bg-muted/50 rounded-lg"
					aria-expanded={showAdvanced}
					onclick={() => (showAdvanced = !showAdvanced)}
				>
					<span>Advanced settings</span>
					{#if showAdvanced}<ChevronUp class="w-4 h-4" />{:else}<ChevronDown class="w-4 h-4" />{/if}
				</button>
				{#if showAdvanced}
					<div class="px-3 pb-3 border-t pt-3 grid grid-cols-3 gap-3">
						<div class="space-y-1">
							<Label for="alert-min-baseline" class="text-xs">Min baseline</Label>
							<Input id="alert-min-baseline" type="number" min="0" bind:value={minBaselineValue} disabled={submitting} />
							<p class="text-xs text-muted-foreground">Ignore if baseline is below this (logs per hour)</p>
						</div>
						<div class="space-y-1">
							<Label for="alert-cooldown" class="text-xs">Cooldown (minutes)</Label>
							<Input id="alert-cooldown" type="number" min="5" max="1440" bind:value={cooldownMinutes} disabled={submitting} />
							<p class="text-xs text-muted-foreground">Wait between alerts</p>
						</div>
						<div class="space-y-1">
							<Label for="alert-sustained" class="text-xs">Sustained (minutes)</Label>
							<Input id="alert-sustained" type="number" min="1" max="60" bind:value={sustainedMinutes} disabled={submitting} />
							<p class="text-xs text-muted-foreground">Anomaly must persist</p>
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<div class="space-y-2">
		<Label>Notification channels</Label>
		<ChannelSelector
			selectedIds={selectedChannelIds}
			onSelectionChange={(ids) => (selectedChannelIds = ids)}
			disabled={submitting}
			placeholder="Select channels..."
		/>
		{#if errors.channels}<p class="text-xs text-destructive-text" role="alert">{errors.channels}</p>{/if}
		<WillNotify eventType="alert" projectId={effectiveProjectId} channelIds={selectedChannelIds} />
	</div>

	{#if isThreshold}
		<div class="border-t pt-4 mt-2">
			{#if !showPreview}
				<div class="flex justify-center">
					<Button
						type="button"
						variant="outline"
						onclick={() => (showPreview = true)}
						disabled={submitting || !canPreview}
						class="gap-2"
					>
						<Eye class="h-4 w-4" />
						Preview alert behavior
					</Button>
				</div>
				<p class="text-xs text-center text-muted-foreground mt-2">
					See how this alert would have performed on historical data
				</p>
			{/if}

			<AlertPreview
				{organizationId}
				projectId={effectiveProjectId}
				service={service.trim() || null}
				levels={selectedLevels as LogLevel[]}
				{threshold}
				{timeWindow}
				query={trimmedQuery || undefined}
				metadataFilters={cleanFilters}
				bind:visible={showPreview}
				onSuggestionApply={handleSuggestionApply}
			/>
		</div>
	{/if}

	<div class="flex justify-end gap-2 pt-2">
		<Button type="button" variant="outline" onclick={onCancel} disabled={submitting}>Cancel</Button>
		<Button type="submit" disabled={submitting}>
			{#if submitting}<Spinner size="sm" className="mr-2" />{/if}
			{submitLabel}
		</Button>
	</div>
</form>
