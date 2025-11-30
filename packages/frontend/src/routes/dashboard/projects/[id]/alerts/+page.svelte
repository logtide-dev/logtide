<script lang="ts">
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { currentOrganization } from '$lib/stores/organization';
	import { alertsAPI, type AlertRule } from '$lib/api/alerts';
	import { toastStore } from '$lib/stores/toast';
	import Card from '$lib/components/ui/card/card.svelte';
	import CardHeader from '$lib/components/ui/card/card-header.svelte';
	import CardTitle from '$lib/components/ui/card/card-title.svelte';
	import CardDescription from '$lib/components/ui/card/card-description.svelte';
	import CardContent from '$lib/components/ui/card/card-content.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import CreateAlertDialog from '$lib/components/CreateAlertDialog.svelte';

	let alertRules = $state<AlertRule[]>([]);
	let loading = $state(false);
	let error = $state('');
	let showCreateDialog = $state(false);
	let deletingAlertId = $state<string | null>(null);
	let lastLoadedKey = $state<string | null>(null);

	const projectId = $derived($page.params.id);

	async function loadAlertRules() {
		if (!$currentOrganization || !projectId) return;

		loading = true;
		error = '';

		try {
			const response = await alertsAPI.getAlertRules($currentOrganization.id, {
				projectId
			});

			alertRules = response.alertRules || [];
			lastLoadedKey = `${$currentOrganization.id}-${projectId}`;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load alert rules';
			toastStore.error(error);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (!browser || !$currentOrganization || !projectId) {
			alertRules = [];
			lastLoadedKey = null;
			return;
		}

		const key = `${$currentOrganization.id}-${projectId}`;
		if (key === lastLoadedKey) return;

		loadAlertRules();
	});

	async function toggleAlert(alert: AlertRule) {
		if (!$currentOrganization) return;

		try {
			await alertsAPI.updateAlertRule($currentOrganization.id, alert.id, {
				enabled: !alert.enabled
			});

			toastStore.success(`Alert ${!alert.enabled ? 'enabled' : 'disabled'}`);
			await loadAlertRules();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to update alert');
		}
	}

	async function deleteAlert(alertId: string) {
		if (!$currentOrganization) return;

		try {
			await alertsAPI.deleteAlertRule(alertId, $currentOrganization.id);

			toastStore.success('Alert deleted successfully');
			deletingAlertId = null;
			await loadAlertRules();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to delete alert');
		}
	}

	function getLevelColor(level: string): string {
		switch (level) {
			case 'debug':
				return 'bg-gray-100 text-gray-800';
			case 'info':
				return 'bg-blue-100 text-blue-800';
			case 'warn':
				return 'bg-yellow-100 text-yellow-800';
			case 'error':
				return 'bg-red-100 text-red-800';
			case 'critical':
				return 'bg-purple-100 text-purple-800';
			default:
				return 'bg-gray-100 text-gray-800';
		}
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h2 class="text-2xl font-bold">Alert Rules</h2>
			<p class="text-muted-foreground">
				Configure alerts to notify you when specific conditions are met
			</p>
		</div>
		<Button onclick={() => (showCreateDialog = true)}>Create Alert</Button>
	</div>

	{#if loading}
		<div class="flex items-center justify-center py-12">
			<Spinner />
			<span class="ml-3 text-muted-foreground">Loading alert rules...</span>
		</div>
	{:else if error}
		<Card>
			<CardContent class="py-12 text-center text-destructive">
				{error}
			</CardContent>
		</Card>
	{:else if alertRules.length === 0}
		<Card>
			<CardContent class="py-12 text-center">
				<p class="text-muted-foreground mb-4">No alert rules configured yet</p>
				<Button onclick={() => (showCreateDialog = true)}>Create Your First Alert</Button>
			</CardContent>
		</Card>
	{:else}
		<div class="grid gap-4">
			{#each alertRules as alert}
				<Card>
					<CardHeader>
						<div class="flex items-start justify-between">
							<div class="space-y-1">
								<div class="flex items-center gap-3">
									<CardTitle>{alert.name}</CardTitle>
									<span
										class="px-2 py-1 text-xs font-semibold rounded-full {alert.enabled
											? 'bg-green-100 text-green-800'
											: 'bg-gray-100 text-gray-800'}"
									>
										{alert.enabled ? 'Enabled' : 'Disabled'}
									</span>
								</div>
								<CardDescription>
									{#if alert.service}
										Service: {alert.service}
									{:else}
										All services
									{/if}
								</CardDescription>
							</div>
							<div class="flex gap-2">
								<Button
									variant="outline"
									size="sm"
									onclick={() => toggleAlert(alert)}
								>
									{alert.enabled ? 'Disable' : 'Enable'}
								</Button>
								<Button
									variant="destructive"
									size="sm"
									onclick={() => (deletingAlertId = alert.id)}
								>
									Delete
								</Button>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
							<div>
								<span class="font-medium">Levels:</span>
								<div class="flex gap-2 mt-1">
									{#each alert.level as level}
										<span class="px-2 py-1 text-xs font-semibold rounded-full {getLevelColor(level)}">
											{level.toUpperCase()}
										</span>
									{/each}
								</div>
							</div>

							<div>
								<span class="font-medium">Threshold:</span>
								<span class="ml-2">
									{alert.threshold} logs in {alert.timeWindow} minute{alert.timeWindow > 1
										? 's'
										: ''}
								</span>
							</div>

							<div>
								<span class="font-medium">Email Recipients:</span>
								<span class="ml-2">{alert.emailRecipients.join(', ')}</span>
							</div>

							{#if alert.webhookUrl}
								<div>
									<span class="font-medium">Webhook:</span>
									<span class="ml-2 text-xs font-mono truncate">{alert.webhookUrl}</span>
								</div>
							{/if}
						</div>
					</CardContent>
				</Card>
			{/each}
		</div>
	{/if}
</div>

<AlertDialog.Root open={deletingAlertId !== null} onOpenChange={(open) => !open && (deletingAlertId = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete Alert Rule</AlertDialog.Title>
			<AlertDialog.Description>
				Are you sure you want to delete this alert rule? This action cannot be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={() => deletingAlertId && deleteAlert(deletingAlertId)}>
				Delete
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

{#if $currentOrganization && projectId}
	<CreateAlertDialog
		bind:open={showCreateDialog}
		organizationId={$currentOrganization.id}
		projectId={projectId}
		onSuccess={loadAlertRules}
	/>
{/if}
