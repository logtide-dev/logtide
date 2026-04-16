<script lang="ts">
	import { alertsAPI, type CreateAlertRuleInput, type PreviewSuggestion, type AlertType, type BaselineType } from "$lib/api/alerts";
	import { sigmaAPI } from "$lib/api/sigma";
	import { toastStore } from "$lib/stores/toast";
	import { checklistStore } from "$lib/stores/checklist";
	import * as Dialog from "$lib/components/ui/dialog";
	import Button from "$lib/components/ui/button/button.svelte";
	import Input from "$lib/components/ui/input/input.svelte";
	import Label from "$lib/components/ui/label/label.svelte";
	import Textarea from "$lib/components/ui/textarea/textarea.svelte";
	import * as Select from "$lib/components/ui/select";
	import {
		Tabs,
		TabsContent,
		TabsList,
		TabsTrigger,
	} from "$lib/components/ui/tabs";
	import Spinner from "$lib/components/Spinner.svelte";
	import AlertPreview from "$lib/components/alerts/AlertPreview.svelte";
	import Eye from "@lucide/svelte/icons/eye";
	import Bell from "@lucide/svelte/icons/bell";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import ChevronUp from "@lucide/svelte/icons/chevron-up";
	import TrendingUp from "@lucide/svelte/icons/trending-up";
	import { ChannelSelector } from "$lib/components/notification-channels";

	interface Props {
		open: boolean;
		organizationId: string;
		projectId?: string | null;
		onSuccess?: () => void;
		onOpenChange?: (open: boolean) => void;
	}

	let {
		open = $bindable(),
		organizationId,
		projectId = null,
		onSuccess,
		onOpenChange,
	}: Props = $props();

	let activeTab = $state("builder");
	let name = $state("");
	let service = $state("");
	let selectedLevels = $state<Set<string>>(new Set(["error", "critical"]));
	let threshold = $state(10);
	let timeWindow = $state(5);
	let selectedChannelIds = $state<string[]>([]);

	// Sigma state
	let sigmaYaml = $state("");
	let sigmaSelectedChannelIds = $state<string[]>([]);

	// Alert type state
	let alertType = $state<AlertType>("threshold");
	let baselineType = $state<BaselineType>("rolling_7d_avg");
	let deviationMultiplier = $state(3);
	let minBaselineValue = $state(10);
	let cooldownMinutes = $state(60);
	let sustainedMinutes = $state(5);
	let showAdvancedRoc = $state(false);

	let submitting = $state(false);
	let showPreview = $state(false);

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

	function resetForm() {
		activeTab = "builder";
		name = "";
		service = "";
		selectedLevels = new Set(["error", "critical"]);
		threshold = 10;
		timeWindow = 5;
		selectedChannelIds = [];

		alertType = "threshold";
		baselineType = "rolling_7d_avg";
		deviationMultiplier = 3;
		minBaselineValue = 10;
		cooldownMinutes = 60;
		sustainedMinutes = 5;
		showAdvancedRoc = false;

		sigmaYaml = "";
		sigmaSelectedChannelIds = [];

		submitting = false;
		showPreview = false;
	}

	function isFormValidForPreview(): boolean {
		if (alertType === "rate_of_change") return false;
		return selectedLevels.size > 0 && threshold >= 1 && timeWindow >= 1;
	}

	function handleShowPreview() {
		if (!isFormValidForPreview()) {
			toastStore.warning("Please set log levels, threshold, and time window to preview");
			return;
		}
		showPreview = true;
	}

	function handleSuggestionApply(suggestion: PreviewSuggestion) {
		if (suggestion.recommendedValue !== undefined) {
			threshold = suggestion.recommendedValue;
			toastStore.success(`Threshold updated to ${suggestion.recommendedValue}`);
		}
		showPreview = false;
	}

	async function handleSubmit() {
		if (activeTab === "builder") {
			await handleBuilderSubmit();
		} else {
			await handleSigmaSubmit();
		}
	}

	async function handleBuilderSubmit() {
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
			const input: CreateAlertRuleInput = {
				organizationId,
				projectId: projectId || null,
				name: name.trim(),
				enabled: true,
				service: service.trim() || null,
				level: Array.from(selectedLevels) as any,
				threshold: alertType === "rate_of_change" ? 1 : threshold,
				timeWindow: alertType === "rate_of_change" ? 60 : timeWindow,
				alertType,
				channelIds: selectedChannelIds,
			};

			if (alertType === "rate_of_change") {
				input.baselineType = baselineType;
				input.deviationMultiplier = deviationMultiplier;
				input.minBaselineValue = minBaselineValue;
				input.cooldownMinutes = cooldownMinutes;
				input.sustainedMinutes = sustainedMinutes;
			}

			await alertsAPI.createAlertRule(input);

			toastStore.success("Alert rule created successfully");
			checklistStore.completeItem('create-alert');
			resetForm();
			open = false;
			onSuccess?.();
		} catch (error) {
			toastStore.error(
				error instanceof Error
					? error.message
					: "Failed to create alert rule",
			);
		} finally {
			submitting = false;
		}
	}

	async function handleSigmaSubmit() {
		if (!sigmaYaml.trim()) {
			toastStore.error("Sigma YAML content is required");
			return;
		}

		submitting = true;

		try {
			const result = await sigmaAPI.importRule({
				yaml: sigmaYaml,
				organizationId,
				projectId: projectId || undefined,
				channelIds: sigmaSelectedChannelIds.length > 0 ? sigmaSelectedChannelIds : undefined,
			});

			if (result.errors && result.errors.length > 0) {
				const errorMsg = `Import failed: ${result.errors.join(", ")}`;
				toastStore.error(errorMsg);
				return;
			}

			toastStore.success("Sigma rule imported successfully");
			checklistStore.completeItem('import-sigma-rule');

			if (result.warnings && result.warnings.length > 0) {
				result.warnings.forEach((warning) => {
					toastStore.warning(warning);
				});
			}

			resetForm();
			open = false;
			onSuccess?.();
		} catch (error) {
			toastStore.error(
				error instanceof Error
					? error.message
					: "Failed to import Sigma rule",
			);
		} finally {
			submitting = false;
		}
	}

	$effect(() => {
		if (!open) {
			resetForm();
		}
	});
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
			<Dialog.Title>Create Alert Rule</Dialog.Title>
			<Dialog.Description>
				Configure an alert to notify you when specific conditions are
				met
			</Dialog.Description>
		</Dialog.Header>

		<Tabs
			value={activeTab}
			onValueChange={(v) => (activeTab = v)}
			class="w-full"
		>
			<TabsList class="grid w-full grid-cols-2 mb-4">
				<TabsTrigger value="builder">Standard Builder</TabsTrigger>
				<TabsTrigger value="sigma">Import Sigma Rule</TabsTrigger>
			</TabsList>

			<TabsContent value="builder">
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
						<Label for="name">Alert Name *</Label>
						<Input
							id="name"
							type="text"
							placeholder={alertType === "rate_of_change" ? "Error rate anomaly" : "High error rate"}
							bind:value={name}
							disabled={submitting}
							required
						/>
					</div>

					<!-- Service Filter -->
					<div class="space-y-2">
						<Label for="service">Service Name (optional)</Label>
						<Input
							id="service"
							type="text"
							placeholder="Leave empty to monitor all services"
							bind:value={service}
							disabled={submitting}
						/>
						<p class="text-xs text-muted-foreground">
							Filter logs by service name. Leave empty to monitor
							all services.
						</p>
					</div>

					<!-- Log Levels -->
					<div class="space-y-2">
						<Label>Log Levels *</Label>
						<div class="flex flex-wrap gap-2">
							{#each availableLevels as level}
								<Button
									type="button"
									variant={selectedLevels.has(level)
										? "default"
										: "outline"}
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
								<Label for="threshold">Threshold *</Label>
								<Input
									id="threshold"
									type="number"
									min="1"
									bind:value={threshold}
									disabled={submitting}
									required
								/>
								<p class="text-xs text-muted-foreground">
									Number of logs
								</p>
							</div>

							<div class="space-y-2">
								<Label for="timeWindow">Time Window *</Label>
								<Input
									id="timeWindow"
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
							Alert triggers when <strong>{threshold}</strong> or more
							logs matching the criteria are received within
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
								<Label for="deviationMultiplier">Deviation Multiplier *</Label>
								<Input
									id="deviationMultiplier"
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
												<Label for="minBaseline" class="text-xs">Min Baseline</Label>
												<Input
													id="minBaseline"
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
												<Label for="cooldown" class="text-xs">Cooldown (min)</Label>
												<Input
													id="cooldown"
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
												<Label for="sustained" class="text-xs">Sustained (min)</Label>
												<Input
													id="sustained"
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

					<!-- Preview Section (threshold only) -->
					{#if alertType === "threshold"}
						<div class="border-t pt-4 mt-2">
							{#if !showPreview}
								<div class="flex justify-center">
									<Button
										type="button"
										variant="outline"
										onclick={handleShowPreview}
										disabled={submitting || !isFormValidForPreview()}
										class="gap-2"
									>
										<Eye class="h-4 w-4" />
										Preview Alert Behavior
									</Button>
								</div>
								<p class="text-xs text-center text-muted-foreground mt-2">
									See how this alert would have performed on historical data
								</p>
							{/if}

							<AlertPreview
								{organizationId}
								{projectId}
								service={service.trim() || null}
								levels={Array.from(selectedLevels) as any}
								{threshold}
								{timeWindow}
								bind:visible={showPreview}
								onSuggestionApply={handleSuggestionApply}
							/>
						</div>
					{/if}
				</form>
			</TabsContent>

			<TabsContent value="sigma">
				<form
					class="space-y-4"
					onsubmit={(e) => {
						e.preventDefault();
						handleSubmit();
					}}
				>
					<div
						class="p-3 bg-blue-50 text-blue-800 rounded-md text-sm mb-4"
					>
						Import a Sigma rule in YAML format. If the rule is
						compatible, it will be automatically converted to a
						LogTide alert rule.
					</div>

					<div class="space-y-2">
						<Label for="sigmaYaml">Sigma Rule YAML *</Label>
						<Textarea
							id="sigmaYaml"
							placeholder="Paste your Sigma rule YAML here..."
							class="font-mono min-h-[300px]"
							bind:value={sigmaYaml}
							disabled={submitting}
							required
						/>
					</div>

					<!-- Notification Channels -->
					<div class="space-y-2">
						<Label>Notification Channels (optional)</Label>
						<ChannelSelector
							selectedIds={sigmaSelectedChannelIds}
							onSelectionChange={(ids) => (sigmaSelectedChannelIds = ids)}
							disabled={submitting}
							placeholder="Select channels..."
						/>
						<p class="text-xs text-muted-foreground">
							Select channels to receive notifications when rule matches
						</p>
					</div>
				</form>
			</TabsContent>
		</Tabs>

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
				{activeTab === "builder" ? "Create Alert" : "Import Rule"}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
