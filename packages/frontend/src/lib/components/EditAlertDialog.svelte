<script lang="ts">
	import { alertsAPI, type AlertRule, type AlertType, type BaselineType } from "$lib/api/alerts";
	import { toastStore } from "$lib/stores/toast";
	import * as Dialog from "$lib/components/ui/dialog";
	import Button from "$lib/components/ui/button/button.svelte";
	import Input from "$lib/components/ui/input/input.svelte";
	import Label from "$lib/components/ui/label/label.svelte";
	import Spinner from "$lib/components/Spinner.svelte";
	import Bell from "@lucide/svelte/icons/bell";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import ChevronUp from "@lucide/svelte/icons/chevron-up";
	import TrendingUp from "@lucide/svelte/icons/trending-up";
	import { ChannelSelector } from "$lib/components/notification-channels";

	interface Props {
		open: boolean;
		organizationId: string;
		alert: AlertRule | null;
		onSuccess?: () => void;
		onOpenChange?: (open: boolean) => void;
	}

	let {
		open = $bindable(),
		organizationId,
		alert,
		onSuccess,
		onOpenChange,
	}: Props = $props();

	let name = $state("");
	let service = $state("");
	let selectedLevels = $state<Set<string>>(new Set());
	let threshold = $state(10);
	let timeWindow = $state(5);
	let selectedChannelIds = $state<string[]>([]);
	let submitting = $state(false);

	// Rate-of-change state
	let alertType = $state<AlertType>("threshold");
	let baselineType = $state<BaselineType>("rolling_7d_avg");
	let deviationMultiplier = $state(3);
	let minBaselineValue = $state(10);
	let cooldownMinutes = $state(60);
	let sustainedMinutes = $state(5);
	let showAdvancedRoc = $state(false);

	const baselineTypeOptions: { value: BaselineType; label: string; desc: string }[] = [
		{ value: "rolling_7d_avg", label: "7-day rolling avg", desc: "Average of the same hour over the last 7 days" },
		{ value: "same_time_yesterday", label: "Same time yesterday", desc: "Compare with the same hour yesterday" },
		{ value: "same_day_last_week", label: "Same day last week", desc: "Compare with the same day/hour last week" },
		{ value: "percentile_p95", label: "95th percentile (7d)", desc: "95th percentile of hourly rates over 7 days" },
	];

	const availableLevels = [
		"debug",
		"info",
		"warn",
		"error",
		"critical",
	] as const;

	function toggleLevel(level: string) {
		const newLevels = new Set(selectedLevels);
		if (newLevels.has(level)) {
			newLevels.delete(level);
		} else {
			newLevels.add(level);
		}
		selectedLevels = newLevels;
	}

	function loadAlertData() {
		if (!alert) return;

		name = alert.name;
		service = alert.service || "";
		selectedLevels = new Set(alert.level);
		threshold = alert.threshold;
		timeWindow = alert.timeWindow;
		selectedChannelIds = alert.channelIds || [];

		alertType = alert.alertType || "threshold";
		baselineType = alert.baselineType || "rolling_7d_avg";
		deviationMultiplier = alert.deviationMultiplier ?? 3;
		minBaselineValue = alert.minBaselineValue ?? 10;
		cooldownMinutes = alert.cooldownMinutes ?? 60;
		sustainedMinutes = alert.sustainedMinutes ?? 5;
		showAdvancedRoc = false;
	}

	$effect(() => {
		if (open && alert) {
			loadAlertData();
		}
	});

	async function handleSubmit() {
		if (!alert) return;

		if (!name.trim()) {
			toastStore.error("Alert name is required");
			return;
		}

		if (selectedLevels.size === 0) {
			toastStore.error("Select at least one log level");
			return;
		}

		if (alertType === "threshold") {
			if (threshold < 1) {
				toastStore.error("Threshold must be at least 1");
				return;
			}
			if (timeWindow < 1) {
				toastStore.error("Time window must be at least 1 minute");
				return;
			}
		}

		if (alertType === "rate_of_change") {
			if (deviationMultiplier < 1.5 || deviationMultiplier > 20) {
				toastStore.error("Deviation multiplier must be between 1.5 and 20");
				return;
			}
		}

		if (selectedChannelIds.length === 0) {
			toastStore.error("Select at least one notification channel");
			return;
		}

		submitting = true;

		try {
			const updateData: Record<string, any> = {
				name: name.trim(),
				service: service.trim() || null,
				level: Array.from(selectedLevels),
				channelIds: selectedChannelIds,
				alertType,
			};

			if (alertType === "threshold") {
				updateData.threshold = threshold;
				updateData.timeWindow = timeWindow;
				updateData.baselineType = null;
				updateData.deviationMultiplier = null;
				updateData.minBaselineValue = null;
				updateData.cooldownMinutes = null;
				updateData.sustainedMinutes = null;
			} else {
				updateData.threshold = 1;
				updateData.timeWindow = 60;
				updateData.baselineType = baselineType;
				updateData.deviationMultiplier = deviationMultiplier;
				updateData.minBaselineValue = minBaselineValue;
				updateData.cooldownMinutes = cooldownMinutes;
				updateData.sustainedMinutes = sustainedMinutes;
			}

			await alertsAPI.updateAlertRule(organizationId, alert.id, updateData);

			toastStore.success("Alert rule updated successfully");
			open = false;
			onSuccess?.();
		} catch (error) {
			toastStore.error(
				error instanceof Error
					? error.message
					: "Failed to update alert rule",
			);
		} finally {
			submitting = false;
		}
	}
</script>

<Dialog.Root
	{open}
	onOpenChange={(o) => {
		open = o;
		onOpenChange?.(o);
	}}
>
	<Dialog.Content class="max-w-2xl max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Edit Alert Rule</Dialog.Title>
			<Dialog.Description>
				Update the alert rule configuration
			</Dialog.Description>
		</Dialog.Header>

		<form
			class="space-y-4"
			onsubmit={(e) => {
				e.preventDefault();
				handleSubmit();
			}}
		>
			<!-- Alert Type Toggle -->
			<div class="space-y-2">
				<Label>Alert Type</Label>
				<div class="grid grid-cols-2 gap-2">
					<button
						type="button"
						class="flex items-center gap-2 p-3 rounded-lg border-2 text-left transition-colors {alertType === 'threshold' ? 'border-primary bg-primary/5' : 'border-muted hover:border-muted-foreground/30'}"
						onclick={() => (alertType = "threshold")}
						disabled={submitting}
					>
						<Bell class="w-5 h-5 {alertType === 'threshold' ? 'text-primary' : 'text-muted-foreground'}" />
						<div>
							<div class="font-medium text-sm">Threshold</div>
							<div class="text-xs text-muted-foreground">Fixed log count limit</div>
						</div>
					</button>
					<button
						type="button"
						class="flex items-center gap-2 p-3 rounded-lg border-2 text-left transition-colors {alertType === 'rate_of_change' ? 'border-primary bg-primary/5' : 'border-muted hover:border-muted-foreground/30'}"
						onclick={() => (alertType = "rate_of_change")}
						disabled={submitting}
					>
						<TrendingUp class="w-5 h-5 {alertType === 'rate_of_change' ? 'text-primary' : 'text-muted-foreground'}" />
						<div>
							<div class="font-medium text-sm">Rate of Change</div>
							<div class="text-xs text-muted-foreground">Anomaly vs baseline</div>
						</div>
					</button>
				</div>
			</div>

			<!-- Alert Name -->
			<div class="space-y-2">
				<Label for="edit-name">Alert Name *</Label>
				<Input
					id="edit-name"
					type="text"
					placeholder={alertType === "rate_of_change" ? "Error rate anomaly" : "High error rate"}
					bind:value={name}
					disabled={submitting}
					required
				/>
			</div>

			<!-- Service Filter -->
			<div class="space-y-2">
				<Label for="edit-service">Service Name (optional)</Label>
				<Input
					id="edit-service"
					type="text"
					placeholder="Leave empty to monitor all services"
					bind:value={service}
					disabled={submitting}
				/>
				<p class="text-xs text-muted-foreground">
					Filter logs by service name. Leave empty to monitor all services.
				</p>
			</div>

			<!-- Log Levels -->
			<div class="space-y-2">
				<Label>Log Levels *</Label>
				<div class="flex flex-wrap gap-2">
					{#each availableLevels as level}
						<Button
							type="button"
							variant={selectedLevels.has(level) ? "default" : "outline"}
							size="sm"
							onclick={() => toggleLevel(level)}
							disabled={submitting}
						>
							{level}
						</Button>
					{/each}
				</div>
				<p class="text-xs text-muted-foreground">
					Select which log levels should trigger this alert
				</p>
			</div>

			{#if alertType === "threshold"}
				<!-- Threshold Config -->
				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-2">
						<Label for="edit-threshold">Threshold *</Label>
						<Input
							id="edit-threshold"
							type="number"
							min="1"
							bind:value={threshold}
							disabled={submitting}
							required
						/>
						<p class="text-xs text-muted-foreground">Number of logs</p>
					</div>

					<div class="space-y-2">
						<Label for="edit-timeWindow">Time Window *</Label>
						<Input
							id="edit-timeWindow"
							type="number"
							min="1"
							bind:value={timeWindow}
							disabled={submitting}
							required
						/>
						<p class="text-xs text-muted-foreground">Minutes</p>
					</div>
				</div>

				<div class="p-3 bg-muted rounded-md text-sm">
					Alert triggers when <strong>{threshold}</strong> or more logs
					matching the criteria are received within
					<strong>{timeWindow}</strong>
					minute{timeWindow > 1 ? "s" : ""}
				</div>
			{:else}
				<!-- Rate of Change Config -->
				<div class="space-y-4">
					<div class="space-y-2">
						<Label>Baseline Method *</Label>
						<div class="grid grid-cols-2 gap-2">
							{#each baselineTypeOptions as opt}
								<button
									type="button"
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
						<Label for="edit-deviationMultiplier">Deviation Multiplier *</Label>
						<Input
							id="edit-deviationMultiplier"
							type="number"
							min="1.5"
							max="20"
							step="0.5"
							bind:value={deviationMultiplier}
							disabled={submitting}
							required
						/>
						<p class="text-xs text-muted-foreground">
							Alert when current rate exceeds baseline by this factor (e.g., 3x = 200% above normal)
						</p>
					</div>

					<div class="p-3 bg-muted rounded-md text-sm">
						Alert triggers when log rate is <strong>{deviationMultiplier}x</strong> above
						the <strong>{baselineTypeOptions.find(o => o.value === baselineType)?.label}</strong> baseline
					</div>

					<!-- Advanced Settings -->
					<div class="border rounded-lg">
						<button
							type="button"
							class="flex items-center justify-between w-full p-3 text-sm font-medium hover:bg-muted/50 rounded-lg"
							onclick={() => (showAdvancedRoc = !showAdvancedRoc)}
						>
							<span>Advanced Settings</span>
							{#if showAdvancedRoc}
								<ChevronUp class="w-4 h-4" />
							{:else}
								<ChevronDown class="w-4 h-4" />
							{/if}
						</button>
						{#if showAdvancedRoc}
							<div class="px-3 pb-3 space-y-3 border-t pt-3">
								<div class="grid grid-cols-3 gap-3">
									<div class="space-y-1">
										<Label for="edit-minBaseline" class="text-xs">Min Baseline</Label>
										<Input
											id="edit-minBaseline"
											type="number"
											min="0"
											bind:value={minBaselineValue}
											disabled={submitting}
										/>
										<p class="text-xs text-muted-foreground">
											Ignore if baseline below this (logs/hr)
										</p>
									</div>
									<div class="space-y-1">
										<Label for="edit-cooldown" class="text-xs">Cooldown (min)</Label>
										<Input
											id="edit-cooldown"
											type="number"
											min="5"
											max="1440"
											bind:value={cooldownMinutes}
											disabled={submitting}
										/>
										<p class="text-xs text-muted-foreground">
											Wait between alerts
										</p>
									</div>
									<div class="space-y-1">
										<Label for="edit-sustained" class="text-xs">Sustained (min)</Label>
										<Input
											id="edit-sustained"
											type="number"
											min="1"
											max="60"
											bind:value={sustainedMinutes}
											disabled={submitting}
										/>
										<p class="text-xs text-muted-foreground">
											Anomaly must persist
										</p>
									</div>
								</div>
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Notification Channels -->
			<div class="space-y-2">
				<Label>Notification Channels *</Label>
				<ChannelSelector
					selectedIds={selectedChannelIds}
					onSelectionChange={(ids) => (selectedChannelIds = ids)}
					disabled={submitting}
					placeholder="Select channels..."
				/>
				<p class="text-xs text-muted-foreground">
					Select channels to receive notifications when alert triggers
				</p>
			</div>
		</form>

		<Dialog.Footer>
			<Button
				type="button"
				variant="outline"
				onclick={() => (open = false)}
				disabled={submitting}
			>
				Cancel
			</Button>
			<Button onclick={handleSubmit} disabled={submitting}>
				{#if submitting}
					<Spinner size="sm" className="mr-2" />
				{/if}
				Save Changes
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
