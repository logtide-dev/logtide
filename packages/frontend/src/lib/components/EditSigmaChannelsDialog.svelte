<script lang="ts">
	import { sigmaAPI, type SigmaRule } from "$lib/api/sigma";
	import { notificationChannelsAPI } from "$lib/api/notification-channels";
	import { currentOrganization } from "$lib/stores/organization";
	import { toastStore } from "$lib/stores/toast";
	import * as Dialog from "$lib/components/ui/dialog";
	import Button from "$lib/components/ui/button/button.svelte";
	import Label from "$lib/components/ui/label/label.svelte";
	import Spinner from "$lib/components/Spinner.svelte";
	import { ChannelSelector } from "$lib/components/notification-channels";
	import SeverityBadge from "$lib/components/app/SeverityBadge.svelte";

	interface Props {
		open: boolean;
		rule: SigmaRule | null;
		onSuccess?: () => void;
		onOpenChange?: (open: boolean) => void;
	}

	let {
		open = $bindable(),
		rule,
		onSuccess,
		onOpenChange,
	}: Props = $props();

	let selectedChannelIds = $state<string[]>([]);
	let submitting = $state(false);
	let loading = $state(false);

	async function loadCurrentChannels() {
		if (!rule || !$currentOrganization) return;

		loading = true;
		try {
			const channels = await notificationChannelsAPI.getSigmaRuleChannels(rule.id);
			selectedChannelIds = channels.map((c) => c.id);
		} catch (error) {
			console.error("Failed to load channels:", error);
			selectedChannelIds = [];
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open && rule) {
			loadCurrentChannels();
		}
	});

	async function handleSubmit() {
		if (!rule || !$currentOrganization) return;

		submitting = true;

		try {
			await sigmaAPI.updateRule(rule.id, {
				organizationId: $currentOrganization.id,
				channelIds: selectedChannelIds,
			});

			toastStore.success("Notification channels updated");
			open = false;
			onSuccess?.();
		} catch (error) {
			toastStore.error(
				error instanceof Error
					? error.message
					: "Failed to update channels",
			);
		} finally {
			submitting = false;
		}
	}

	function getLevelColor(level: string): string {
		switch (level) {
			case "informational":
				return "bg-blue-100 text-blue-800";
			case "low":
				return "bg-green-100 text-green-800";
			case "medium":
				return "bg-yellow-100 text-yellow-800";
			case "high":
				return "bg-orange-100 text-orange-800";
			case "critical":
				return "bg-red-100 text-red-800";
			default:
				return "bg-gray-100 text-gray-800";
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
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				Edit notification channels
			</Dialog.Title>
			{#if rule}
				<Dialog.Description class="flex items-center gap-2">
					<span>{rule.title}</span>
					<SeverityBadge kind="severity" value={rule.level || "medium"} />
				</Dialog.Description>
			{/if}
		</Dialog.Header>

		{#if loading}
			<div class="flex items-center justify-center py-8">
				<Spinner />
				<span class="ml-2 text-muted-foreground">Loading channels</span>
			</div>
		{:else}
			<div class="space-y-4 py-4">
				<div class="space-y-2">
					<Label>Notification channels</Label>
					<ChannelSelector
						selectedIds={selectedChannelIds}
						onSelectionChange={(ids) => (selectedChannelIds = ids)}
						disabled={submitting}
						placeholder="Select channels"
					/>
					<p class="text-xs text-muted-foreground">
						Choose the channels that receive a notification when this rule matches
					</p>
				</div>
			</div>
		{/if}

		<Dialog.Footer>
			<Button
				type="button"
				variant="outline"
				onclick={() => (open = false)}
				disabled={submitting || loading}
			>
				Cancel
			</Button>
			<Button onclick={handleSubmit} disabled={submitting || loading}>
				{#if submitting}
					<Spinner size="sm" className="mr-2" />
				{/if}
				Save changes
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
