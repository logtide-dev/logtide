<script lang="ts">
	import { alertsAPI, type AlertRule, type CreateAlertRuleInput, type UpdateAlertRuleInput } from "$lib/api/alerts";
	import { projectsAPI } from "$lib/api/projects";
	import { toastStore } from "$lib/stores/toast";
	import * as Dialog from "$lib/components/ui/dialog";
	import AlertRuleForm from "$lib/components/alerts/AlertRuleForm.svelte";

	interface Props {
		open: boolean;
		organizationId: string;
		alert: AlertRule | null;
		onSuccess?: () => void;
		onOpenChange?: (open: boolean) => void;
		/** Projects used to name the read-only scope; loaded here when absent. */
		projects?: { id: string; name: string }[];
	}

	let {
		open = $bindable(),
		organizationId,
		alert,
		onSuccess,
		onOpenChange,
		projects,
	}: Props = $props();

	let submitting = $state(false);
	let loadedProjects = $state<{ id: string; name: string }[]>([]);
	const projectList = $derived(projects ?? loadedProjects);

	$effect(() => {
		if (!open || projects) return;
		let active = true;
		projectsAPI
			.getProjects(organizationId)
			.then((res) => {
				if (active) loadedProjects = res.projects.map((p) => ({ id: p.id, name: p.name }));
			})
			.catch(() => {
				if (active) loadedProjects = [];
			});
		return () => {
			active = false;
		};
	});

	function close() {
		open = false;
		onOpenChange?.(false);
	}

	async function handleSubmit(input: Omit<CreateAlertRuleInput, "organizationId">) {
		if (!alert) return;
		submitting = true;
		try {
			const { projectId: _scope, enabled: _enabled, ...fields } = input;
			const update: UpdateAlertRuleInput = { ...fields };
			if (input.alertType === "threshold") {
				update.baselineType = null;
				update.deviationMultiplier = null;
				update.minBaselineValue = null;
				update.cooldownMinutes = null;
				update.sustainedMinutes = null;
			} else {
				// Text queries and renotify apply to threshold rules only.
				update.query = null;
				update.renotifyMinutes = null;
			}
			await alertsAPI.updateAlertRule(organizationId, alert.id, update);
			toastStore.success("Alert rule updated");
			close();
			onSuccess?.();
		} catch (error) {
			toastStore.error(error instanceof Error ? error.message : "Failed to update alert rule");
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
			<Dialog.Title>Edit alert rule</Dialog.Title>
			<Dialog.Description>Update the alert rule configuration</Dialog.Description>
		</Dialog.Header>

		{#if open && alert}
			{#key alert.id}
				<AlertRuleForm
					mode="edit"
					{organizationId}
					projects={projectList}
					initial={{
						name: alert.name,
						service: alert.service,
						levels: alert.level,
						threshold: alert.threshold,
						timeWindow: alert.timeWindow,
						alertType: alert.alertType || "threshold",
						baselineType: alert.baselineType,
						deviationMultiplier: alert.deviationMultiplier,
						minBaselineValue: alert.minBaselineValue,
						cooldownMinutes: alert.cooldownMinutes,
						sustainedMinutes: alert.sustainedMinutes,
						metadataFilters: alert.metadataFilters ?? [],
						channelIds: alert.channelIds ?? [],
						projectId: alert.projectId,
						query: alert.query ?? "",
						renotifyMinutes: alert.renotifyMinutes ?? null,
					}}
					{submitting}
					submitLabel="Save changes"
					onSubmit={handleSubmit}
					onCancel={close}
				/>
			{/key}
		{/if}
	</Dialog.Content>
</Dialog.Root>
