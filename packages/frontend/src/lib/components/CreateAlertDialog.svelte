<script lang="ts">
	import { alertsAPI, type CreateAlertRuleInput, type AlertBuilderPrefill } from "$lib/api/alerts";
	import { projectsAPI } from "$lib/api/projects";
	import { toastStore } from "$lib/stores/toast";
	import { checklistStore } from "$lib/stores/checklist";
	import * as Dialog from "$lib/components/ui/dialog";
	import AlertRuleForm from "$lib/components/alerts/AlertRuleForm.svelte";

	interface Props {
		open: boolean;
		organizationId: string;
		projectId?: string | null;
		onSuccess?: () => void;
		onOpenChange?: (open: boolean) => void;
		/** Values used to prefill the builder when the dialog opens (create-from-error, duplicate). */
		initialValues?: AlertBuilderPrefill;
		/** Projects for the Scope field; loaded here when the caller does not pass them. */
		projects?: { id: string; name: string }[];
	}

	let {
		open = $bindable(),
		organizationId,
		projectId = null,
		onSuccess,
		onOpenChange,
		initialValues,
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
		submitting = true;
		try {
			await alertsAPI.createAlertRule({ ...input, organizationId });
			toastStore.success("Alert rule created");
			checklistStore.completeItem("create-alert");
			close();
			onSuccess?.();
		} catch (error) {
			toastStore.error(error instanceof Error ? error.message : "Failed to create alert rule");
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
			<Dialog.Title>Create alert rule</Dialog.Title>
			<Dialog.Description>
				Get notified when specific conditions are met. To import a Sigma rule, go to
				<a href="/dashboard/security/rules" class="underline underline-offset-2 hover:text-foreground">Security &gt; Rules</a>.
			</Dialog.Description>
		</Dialog.Header>

		{#if open}
			<AlertRuleForm
				mode="create"
				{organizationId}
				projects={projectList}
				initial={{ ...initialValues, projectId: projectId ?? initialValues?.projectId ?? null }}
				lockedProjectId={projectId}
				{submitting}
				submitLabel="Create alert"
				onSubmit={handleSubmit}
				onCancel={close}
			/>
		{/if}
	</Dialog.Content>
</Dialog.Root>
