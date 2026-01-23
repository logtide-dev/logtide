<script lang="ts">
	import {
		detectionPacksAPI,
		type DetectionPackWithStatus,
		type ThresholdMap,
		type SigmaLevel,
	} from "$lib/api/detection-packs";
	import { toastStore } from "$lib/stores/toast";
	import * as Dialog from "$lib/components/ui/dialog";
	import Button from "$lib/components/ui/button/button.svelte";
	import Input from "$lib/components/ui/input/input.svelte";
	import Label from "$lib/components/ui/label/label.svelte";
	import { Badge } from "$lib/components/ui/badge";
	import * as Select from "$lib/components/ui/select";
	import Spinner from "$lib/components/Spinner.svelte";
	import Rocket from "@lucide/svelte/icons/rocket";
	import Shield from "@lucide/svelte/icons/shield";
	import Database from "@lucide/svelte/icons/database";
	import CreditCard from "@lucide/svelte/icons/credit-card";
	import CheckCircle from "@lucide/svelte/icons/check-circle";
	import XCircle from "@lucide/svelte/icons/x-circle";
	import ExternalLink from "@lucide/svelte/icons/external-link";
	import Tag from "@lucide/svelte/icons/tag";

	interface Props {
		open: boolean;
		pack: DetectionPackWithStatus | null;
		organizationId: string;
		onSuccess?: () => void;
		onOpenChange?: (open: boolean) => void;
	}

	let {
		open = $bindable(),
		pack,
		organizationId,
		onSuccess,
		onOpenChange,
	}: Props = $props();

	let customThresholds = $state<ThresholdMap>({});
	let emailRecipients = $state("");
	let webhookUrl = $state("");
	let submitting = $state(false);
	let disabling = $state(false);

	const iconMap: Record<string, typeof Rocket> = {
		rocket: Rocket,
		shield: Shield,
		database: Database,
		"credit-card": CreditCard,
	};

	const categoryColors: Record<string, string> = {
		reliability: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
		security: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
		database: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
		business: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
	};

	const levelOptions: { value: SigmaLevel; label: string }[] = [
		{ value: "informational", label: "Informational" },
		{ value: "low", label: "Low" },
		{ value: "medium", label: "Medium" },
		{ value: "high", label: "High" },
		{ value: "critical", label: "Critical" },
	];

	function initializeThresholds() {
		if (!pack) return;

		const initial: ThresholdMap = {};
		for (const rule of pack.rules) {
			const existing = pack.customThresholds?.[rule.id];
			initial[rule.id] = {
				level: existing?.level ?? rule.level,
			};
		}
		customThresholds = initial;
	}

	function resetForm() {
		emailRecipients = "";
		webhookUrl = "";
		submitting = false;
		disabling = false;
		initializeThresholds();
	}

	$effect(() => {
		if (open && pack) {
			initializeThresholds();
		}
	});

	$effect(() => {
		if (!open) {
			resetForm();
		}
	});

	async function handleEnable() {
		if (!pack) return;

		const emails = emailRecipients
			.split(",")
			.map((e) => e.trim())
			.filter((e) => e);

		// Basic email validation if provided
		if (emails.length > 0) {
			const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
			const invalidEmails = emails.filter((e) => !emailRegex.test(e));
			if (invalidEmails.length > 0) {
				toastStore.error(`Invalid email addresses: ${invalidEmails.join(", ")}`);
				return;
			}
		}

		submitting = true;

		try {
			await detectionPacksAPI.enablePack(pack.id, {
				organizationId,
				customThresholds,
				emailRecipients: emails.length > 0 ? emails : undefined,
				webhookUrl: webhookUrl.trim() || null,
			});

			toastStore.success(`${pack.name} enabled successfully`);
			resetForm();
			open = false;
			onSuccess?.();
		} catch (error) {
			toastStore.error(
				error instanceof Error ? error.message : "Failed to enable pack"
			);
		} finally {
			submitting = false;
		}
	}

	async function handleDisable() {
		if (!pack) return;

		disabling = true;

		try {
			await detectionPacksAPI.disablePack(pack.id, organizationId);

			toastStore.success(`${pack.name} disabled`);
			resetForm();
			open = false;
			onSuccess?.();
		} catch (error) {
			toastStore.error(
				error instanceof Error ? error.message : "Failed to disable pack"
			);
		} finally {
			disabling = false;
		}
	}

	async function handleUpdateThresholds() {
		if (!pack) return;

		submitting = true;

		try {
			await detectionPacksAPI.updateThresholds(pack.id, {
				organizationId,
				customThresholds,
			});

			toastStore.success("Settings updated");
			onSuccess?.();
		} catch (error) {
			toastStore.error(
				error instanceof Error ? error.message : "Failed to update settings"
			);
		} finally {
			submitting = false;
		}
	}

	function getLevelColor(level: SigmaLevel): string {
		switch (level) {
			case "informational":
				return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
			case "low":
				return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
			case "medium":
				return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
			case "high":
				return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
			case "critical":
				return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
			default:
				return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
		}
	}

	function getMitreTag(tag: string): { type: "tactic" | "technique"; name: string } | null {
		const lowerTag = tag.toLowerCase();
		if (/^attack\.t\d{4}(\.\d{3})?$/i.test(lowerTag)) {
			return { type: "technique", name: tag.replace("attack.", "").toUpperCase() };
		}
		if (lowerTag.startsWith("attack.") && !lowerTag.match(/^attack\.t\d/)) {
			return { type: "tactic", name: tag.replace("attack.", "").replace(/_/g, " ") };
		}
		return null;
	}

	function formatDetectionPattern(detection: Record<string, unknown>): string {
		const parts: string[] = [];
		for (const [key, value] of Object.entries(detection)) {
			if (key === "condition") continue;
			if (Array.isArray(value)) {
				parts.push(`${key}: [${value.slice(0, 3).join(", ")}${value.length > 3 ? "..." : ""}]`);
			} else if (typeof value === "object" && value !== null) {
				const obj = value as Record<string, unknown>;
				for (const [subKey, subVal] of Object.entries(obj)) {
					if (Array.isArray(subVal)) {
						parts.push(`${subKey}: [${subVal.slice(0, 2).join(", ")}${subVal.length > 2 ? "..." : ""}]`);
					}
				}
			}
		}
		return parts.join(" | ") || "Pattern-based detection";
	}
</script>

<Dialog.Root
	{open}
	onOpenChange={(o) => {
		open = o;
		onOpenChange?.(o);
	}}
>
	<Dialog.Content class="max-w-3xl max-h-[90vh] overflow-y-auto">
		{#if pack}
			{@const Icon = iconMap[pack.icon] || Rocket}
			<Dialog.Header>
				<div class="flex items-center gap-3">
					<div
						class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"
					>
						<Icon class="w-5 h-5 text-primary" />
					</div>
					<div>
						<Dialog.Title class="flex items-center gap-2">
							{pack.name}
							{#if pack.enabled}
								<Badge variant="default" class="gap-1">
									<CheckCircle class="w-3 h-3" />
									Enabled
								</Badge>
							{:else}
								<Badge variant="secondary">Disabled</Badge>
							{/if}
						</Dialog.Title>
						<Dialog.Description class="mt-1">
							{pack.description}
						</Dialog.Description>
					</div>
				</div>
			</Dialog.Header>

			<div class="space-y-6 py-4">
				<!-- Pack Info -->
				<div class="flex items-center gap-2 flex-wrap">
					<Badge class={categoryColors[pack.category]}>
						{pack.category}
					</Badge>
					<span class="text-sm text-muted-foreground">
						{pack.rules.length} Sigma rules
					</span>
					{#if pack.enabled && pack.generatedRulesCount > 0}
						<span class="text-sm text-muted-foreground">
							({pack.generatedRulesCount} active)
						</span>
					{/if}
					{#if pack.author}
						<span class="text-sm text-muted-foreground">
							by {pack.author}
						</span>
					{/if}
					{#if pack.version}
						<Badge variant="outline" class="text-xs">v{pack.version}</Badge>
					{/if}
				</div>

				<!-- Rules List with Level Customization -->
				<div class="space-y-4">
					<h4 class="font-medium text-sm">Detection Rules (Sigma)</h4>
					<div class="space-y-3">
						{#each pack.rules as rule}
							<div class="border rounded-lg p-4 space-y-3">
								<div class="flex items-start justify-between">
									<div class="flex-1">
										<h5 class="font-medium">{rule.name}</h5>
										<p class="text-sm text-muted-foreground">
											{rule.description}
										</p>
									</div>
									<Badge class={getLevelColor(customThresholds[rule.id]?.level ?? rule.level)}>
										{customThresholds[rule.id]?.level ?? rule.level}
									</Badge>
								</div>

								<!-- Detection Pattern Preview -->
								<div class="bg-muted/50 rounded p-2 text-xs font-mono">
									{formatDetectionPattern(rule.detection)}
								</div>

								<!-- MITRE ATT&CK Tags -->
								{#if rule.tags && rule.tags.length > 0}
									<div class="flex flex-wrap gap-1">
										{#each rule.tags as tag}
											{@const mitre = getMitreTag(tag)}
											{#if mitre}
												<Badge
													variant="outline"
													class="text-xs {mitre.type === 'technique' ? 'border-purple-500 text-purple-700 dark:text-purple-300' : 'border-blue-500 text-blue-700 dark:text-blue-300'}"
												>
													<Tag class="w-3 h-3 mr-1" />
													{mitre.name}
												</Badge>
											{/if}
										{/each}
									</div>
								{/if}

								<!-- Level Override -->
								<div class="flex items-center gap-4">
									<div class="flex items-center gap-2">
										<Label for="level-{rule.id}" class="text-xs whitespace-nowrap">
											Severity Level
										</Label>
										<Select.Root
											type="single"
											value={customThresholds[rule.id]?.level ?? rule.level}
											onValueChange={(v) => {
												customThresholds = {
													...customThresholds,
													[rule.id]: {
														...customThresholds[rule.id],
														level: v as SigmaLevel,
													},
												};
											}}
											disabled={submitting || disabling}
										>
											<Select.Trigger class="w-32 h-8 text-xs">
												{customThresholds[rule.id]?.level ?? rule.level}
											</Select.Trigger>
											<Select.Content>
												{#each levelOptions as opt}
													<Select.Item value={opt.value}>{opt.label}</Select.Item>
												{/each}
											</Select.Content>
										</Select.Root>
									</div>
									{#if rule.references && rule.references.length > 0}
										<a
											href={rule.references[0]}
											target="_blank"
											rel="noopener noreferrer"
											class="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
										>
											<ExternalLink class="w-3 h-3" />
											MITRE Reference
										</a>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>

				<!-- Notification Settings (only for enabling) -->
				{#if !pack.enabled}
					<div class="space-y-4 border-t pt-4">
						<h4 class="font-medium text-sm">Notification Settings</h4>

						<div class="space-y-2">
							<Label for="emails">Email Recipients (optional)</Label>
							<Input
								id="emails"
								type="text"
								placeholder="user@example.com, team@example.com"
								bind:value={emailRecipients}
								disabled={submitting}
							/>
							<p class="text-xs text-muted-foreground">
								Comma-separated list of email addresses. You can add these later
								from the Sigma Rules page.
							</p>
						</div>

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
								HTTP POST webhook to call when detection triggers
							</p>
						</div>
					</div>
				{/if}

				<!-- SIEM Integration Info -->
				<div class="bg-muted/50 rounded-lg p-4 space-y-2">
					<h4 class="font-medium text-sm flex items-center gap-2">
						<Shield class="w-4 h-4" />
						SIEM Integration
					</h4>
					<p class="text-xs text-muted-foreground">
						When enabled, this pack creates Sigma rules that integrate with the SIEM dashboard.
						Detections will appear in the Security Dashboard, create incidents, and can be
						correlated with MITRE ATT&CK framework.
					</p>
				</div>
			</div>

			<Dialog.Footer class="flex-col sm:flex-row gap-2">
				{#if pack.enabled}
					<Button
						variant="destructive"
						onclick={handleDisable}
						disabled={disabling || submitting}
						class="gap-2"
					>
						{#if disabling}
							<Spinner size="sm" />
						{:else}
							<XCircle class="w-4 h-4" />
						{/if}
						Disable Pack
					</Button>
					<div class="flex-1"></div>
					<Button
						variant="outline"
						onclick={() => (open = false)}
						disabled={submitting || disabling}
					>
						Cancel
					</Button>
					<Button onclick={handleUpdateThresholds} disabled={submitting || disabling}>
						{#if submitting}
							<Spinner size="sm" className="mr-2" />
						{/if}
						Save Changes
					</Button>
				{:else}
					<Button
						variant="outline"
						onclick={() => (open = false)}
						disabled={submitting}
					>
						Cancel
					</Button>
					<Button onclick={handleEnable} disabled={submitting} class="gap-2">
						{#if submitting}
							<Spinner size="sm" />
						{:else}
							<CheckCircle class="w-4 h-4" />
						{/if}
						Enable Pack
					</Button>
				{/if}
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
