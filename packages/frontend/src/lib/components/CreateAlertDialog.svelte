<script lang="ts">
	import { alertsAPI, type CreateAlertRuleInput, type PreviewSuggestion } from "$lib/api/alerts";
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
	let emailRecipients = $state("");
	let webhookUrl = $state("");

	// Sigma state
	let sigmaYaml = $state("");
	let sigmaEmailRecipients = $state("");
	let sigmaWebhookUrl = $state("");

	let submitting = $state(false);
	let showPreview = $state(false);

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
		emailRecipients = "";
		webhookUrl = "";

		sigmaYaml = "";
		sigmaEmailRecipients = "";
		sigmaWebhookUrl = "";

		submitting = false;
		showPreview = false;
	}

	function isFormValidForPreview(): boolean {
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
		// Validation
		if (!name.trim()) {
			toastStore.error("Alert name is required");
			return;
		}

		if (selectedLevels.size === 0) {
			toastStore.error("Select at least one log level");
			return;
		}

		if (threshold < 1) {
			toastStore.error("Threshold must be at least 1");
			return;
		}

		if (timeWindow < 1) {
			toastStore.error("Time window must be at least 1 minute");
			return;
		}

		const emails = emailRecipients
			.split(",")
			.map((e) => e.trim())
			.filter((e) => e);

		if (emails.length === 0) {
			toastStore.error("At least one email recipient is required");
			return;
		}

		// Basic email validation
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		const invalidEmails = emails.filter((e) => !emailRegex.test(e));
		if (invalidEmails.length > 0) {
			toastStore.error(
				`Invalid email addresses: ${invalidEmails.join(", ")}`,
			);
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
				threshold,
				timeWindow,
				emailRecipients: emails,
				webhookUrl: webhookUrl.trim() || null,
			};

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

		const emails = sigmaEmailRecipients
			.split(",")
			.map((e) => e.trim())
			.filter((e) => e);

		// Basic email validation if provided
		if (emails.length > 0) {
			const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
			const invalidEmails = emails.filter((e) => !emailRegex.test(e));
			if (invalidEmails.length > 0) {
				toastStore.error(
					`Invalid email addresses: ${invalidEmails.join(", ")}`,
				);
				return;
			}
		}

		submitting = true;

		try {
			const result = await sigmaAPI.importRule({
				yaml: sigmaYaml,
				organizationId,
				projectId: projectId || undefined,
				emailRecipients: emails.length > 0 ? emails : undefined,
				webhookUrl: sigmaWebhookUrl.trim() || undefined,
			});

			// Check for errors
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
					<!-- Alert Name -->
					<div class="space-y-2">
						<Label for="name">Alert Name *</Label>
						<Input
							id="name"
							type="text"
							placeholder="High error rate"
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

					<div class="space-y-2">
						<Label for="emails">Email Recipients *</Label>
						<Input
							id="emails"
							type="text"
							placeholder="user@example.com, team@example.com"
							bind:value={emailRecipients}
							disabled={submitting}
							required
						/>
						<p class="text-xs text-muted-foreground">
							Comma-separated list of email addresses
						</p>
					</div>

					<!-- Webhook URL -->
					<div class="space-y-2">
						<Label for="webhook">Webhook URL (optional)</Label>
						<Input
							id="webhook"
							type="url"
							placeholder="https://hooks.slack.com/..."
							bind:value={webhookUrl}
							disabled={submitting}
						/>
						<p class="text-xs text-muted-foreground">
							HTTP POST webhook to call when alert triggers
						</p>
					</div>

					<!-- Preview Section -->
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

					<div class="space-y-2">
						<Label for="sigmaEmails"
							>Email Recipients (optional)</Label
						>
						<Input
							id="sigmaEmails"
							type="text"
							placeholder="user@example.com, team@example.com"
							bind:value={sigmaEmailRecipients}
							disabled={submitting}
						/>
						<p class="text-xs text-muted-foreground">
							Override recipients defined in the rule (if any)
						</p>
					</div>

					<div class="space-y-2">
						<Label for="sigmaWebhook">Webhook URL (optional)</Label>
						<Input
							id="sigmaWebhook"
							type="url"
							placeholder="https://hooks.slack.com/..."
							bind:value={sigmaWebhookUrl}
							disabled={submitting}
						/>
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
