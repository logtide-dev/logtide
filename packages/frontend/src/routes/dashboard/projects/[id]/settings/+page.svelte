<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { currentOrganization } from '$lib/stores/organization';
	import { projectsAPI } from '$lib/api/projects';
	import { apiKeysAPI, type ApiKey } from '$lib/api/api-keys';
	import { toastStore } from '$lib/stores/toast';
	import Card from '$lib/components/ui/card/card.svelte';
	import CardHeader from '$lib/components/ui/card/card-header.svelte';
	import CardTitle from '$lib/components/ui/card/card-title.svelte';
	import CardDescription from '$lib/components/ui/card/card-description.svelte';
	import CardContent from '$lib/components/ui/card/card-content.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import CreateApiKeyDialog from '$lib/components/CreateApiKeyDialog.svelte';
	import { Trash2, Plus } from '@lucide/svelte/icons';

	let project = $state<any>(null);
	let loading = $state(false);
	let saving = $state(false);
	let error = $state('');
	let showDeleteDialog = $state(false);
	let lastLoadedKey = $state<string | null>(null);

	let name = $state('');
	let description = $state('');

	let apiKeys = $state<ApiKey[]>([]);
	let loadingApiKeys = $state(false);
	let showCreateApiKeyDialog = $state(false);
	let apiKeyToDelete = $state<ApiKey | null>(null);
	let lastLoadedApiKeysKey = $state<string | null>(null);

	const projectId = $derived($page.params.id);

	async function loadProject() {
		if (!$currentOrganization || !projectId) return;

		loading = true;
		error = '';

		try {
			const response = await projectsAPI.getProjects($currentOrganization.id);
			const foundProject = response.projects.find((p) => p.id === projectId);

			if (!foundProject) {
				error = 'Project not found';
				toastStore.error('Project not found');
				goto('/dashboard/projects');
				return;
			}

			project = foundProject;
			name = foundProject.name;
			description = foundProject.description || '';
			lastLoadedKey = `${$currentOrganization.id}-${projectId}`;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load project';
			toastStore.error(error);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (!browser || !$currentOrganization || !projectId) {
			project = null;
			lastLoadedKey = null;
			return;
		}

		const key = `${$currentOrganization.id}-${projectId}`;
		if (key === lastLoadedKey) return;

		loadProject();
	});

	$effect(() => {
		if (!browser || !projectId) {
			apiKeys = [];
			lastLoadedApiKeysKey = null;
			return;
		}

		if (projectId === lastLoadedApiKeysKey) return;

		loadApiKeys();
	});

	async function handleSave() {
		if (!$currentOrganization || !projectId) return;

		if (!name.trim()) {
			toastStore.error('Project name is required');
			return;
		}

		saving = true;

		try {
			await projectsAPI.updateProject($currentOrganization.id, projectId, {
				name: name.trim(),
				description: description.trim() || null
			});

			toastStore.success('Project updated successfully');
			await loadProject();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to update project');
		} finally {
			saving = false;
		}
	}

	async function handleDelete() {
		if (!$currentOrganization || !projectId) return;

		try {
			await projectsAPI.deleteProject($currentOrganization.id, projectId);

			toastStore.success('Project deleted successfully');
			goto('/dashboard/projects');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to delete project');
		}
	}

	async function loadApiKeys() {
		if (!projectId) return;

		loadingApiKeys = true;

		try {
			const response = await apiKeysAPI.list(projectId);
			apiKeys = response.apiKeys;
			lastLoadedApiKeysKey = projectId;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load API keys');
		} finally {
			loadingApiKeys = false;
		}
	}

	async function handleCreateApiKey(data: { name: string }) {
		if (!projectId) throw new Error('No project ID');

		const response = await apiKeysAPI.create(projectId, data);
		toastStore.success('API key created successfully');
		await loadApiKeys();
		return response;
	}

	async function handleDeleteApiKey() {
		if (!projectId || !apiKeyToDelete) return;

		try {
			await apiKeysAPI.delete(projectId, apiKeyToDelete.id);
			toastStore.success('API key deleted successfully');
			await loadApiKeys();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to delete API key');
		} finally {
			apiKeyToDelete = null;
		}
	}

	function formatDate(date: string | null): string {
		if (!date) return 'Never';
		return new Date(date).toLocaleString();
	}

	const hasChanges = $derived(
		project && (name !== project.name || description !== (project.description || ''))
	);
</script>

<div class="space-y-6">
	{#if loading}
		<div class="flex items-center justify-center py-12">
			<Spinner />
			<span class="ml-3 text-muted-foreground">Loading settings...</span>
		</div>
	{:else if error}
		<Card>
			<CardContent class="py-12 text-center text-destructive">
				{error}
			</CardContent>
		</Card>
	{:else if project}
		<Card>
			<CardHeader>
				<CardTitle>General Settings</CardTitle>
				<CardDescription>Update your project name and description</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<div class="space-y-2">
					<Label for="name">Project Name</Label>
					<Input
						id="name"
						type="text"
						placeholder="My Project"
						bind:value={name}
						disabled={saving}
					/>
				</div>

				<div class="space-y-2">
					<Label for="description">Description</Label>
					<Input
						id="description"
						type="text"
						placeholder="Optional description"
						bind:value={description}
						disabled={saving}
					/>
				</div>

				<div class="flex justify-end">
					<Button onclick={handleSave} disabled={!hasChanges || saving}>
						{#if saving}
							<Spinner size="sm" />
						{/if}
						Save Changes
					</Button>
				</div>
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle>Project Information</CardTitle>
				<CardDescription>Read-only project details</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<div class="space-y-2">
					<Label>Project ID</Label>
					<div class="flex gap-2">
						<Input value={project.id} readonly class="font-mono text-sm" />
						<Button
							variant="outline"
							onclick={() => {
								navigator.clipboard.writeText(project.id);
								toastStore.success('Project ID copied to clipboard');
							}}
						>
							Copy
						</Button>
					</div>
				</div>

				<div class="space-y-2">
					<Label>Created</Label>
					<Input value={new Date(project.createdAt).toLocaleString()} readonly />
				</div>

				<div class="space-y-2">
					<Label>Last Updated</Label>
					<Input value={new Date(project.updatedAt).toLocaleString()} readonly />
				</div>
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<div class="flex items-center justify-between">
					<div>
						<CardTitle>API Keys</CardTitle>
						<CardDescription>Manage API keys for programmatic log ingestion</CardDescription>
					</div>
					<Button onclick={() => (showCreateApiKeyDialog = true)} class="gap-2">
						<Plus class="w-4 h-4" />
						Create API Key
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				{#if loadingApiKeys}
					<div class="flex items-center justify-center py-8">
						<Spinner />
						<span class="ml-3 text-muted-foreground">Loading API keys...</span>
					</div>
				{:else if apiKeys.length === 0}
					<div class="text-center py-8 text-muted-foreground">
						<p>No API keys yet</p>
						<p class="text-sm">Create your first API key to start sending logs</p>
					</div>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full">
							<thead>
								<tr class="border-b">
									<th class="text-left py-3 px-4 font-medium">Name</th>
									<th class="text-left py-3 px-4 font-medium">Created</th>
									<th class="text-left py-3 px-4 font-medium">Last Used</th>
									<th class="text-right py-3 px-4 font-medium">Actions</th>
								</tr>
							</thead>
							<tbody>
								{#each apiKeys as apiKey (apiKey.id)}
									<tr class="border-b hover:bg-muted/50">
										<td class="py-3 px-4 font-medium">{apiKey.name}</td>
										<td class="py-3 px-4 text-sm text-muted-foreground">
											{formatDate(apiKey.createdAt)}
										</td>
										<td class="py-3 px-4 text-sm text-muted-foreground">
											{formatDate(apiKey.lastUsed)}
										</td>
										<td class="py-3 px-4 text-right">
											<Button
												variant="ghost"
												size="sm"
												onclick={() => (apiKeyToDelete = apiKey)}
												class="gap-2 text-destructive hover:text-destructive"
											>
												<Trash2 class="w-4 h-4" />
												Delete
											</Button>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</CardContent>
		</Card>

		<Card class="border-destructive">
			<CardHeader>
				<CardTitle class="text-destructive">Danger Zone</CardTitle>
				<CardDescription>Irreversible and destructive actions</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="flex items-center justify-between">
					<div>
						<h4 class="font-medium">Delete Project</h4>
						<p class="text-sm text-muted-foreground">
							Permanently delete this project and all its logs. This action cannot be undone.
						</p>
					</div>
					<Button variant="destructive" onclick={() => (showDeleteDialog = true)}>
						Delete Project
					</Button>
				</div>
			</CardContent>
		</Card>
	{/if}
</div>

<CreateApiKeyDialog bind:open={showCreateApiKeyDialog} onSubmit={handleCreateApiKey} />

<AlertDialog.Root
	open={apiKeyToDelete !== null}
	onOpenChange={(open) => !open && (apiKeyToDelete = null)}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete API Key</AlertDialog.Title>
			<AlertDialog.Description>
				Are you sure you want to delete the API key <strong>{apiKeyToDelete?.name}</strong>?
				Applications using this key will no longer be able to send logs. This action cannot be
				undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={handleDeleteApiKey}>Delete API Key</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root open={showDeleteDialog} onOpenChange={(open) => (showDeleteDialog = open)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete Project</AlertDialog.Title>
			<AlertDialog.Description>
				Are you sure you want to delete <strong>{project?.name}</strong>? This will permanently
				delete all logs and alert rules associated with this project. This action cannot be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={handleDelete}>Delete Project</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
