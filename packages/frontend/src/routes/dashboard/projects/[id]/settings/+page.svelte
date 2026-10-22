<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { currentOrganization } from '$lib/stores/organization';
  import { projectsAPI } from '$lib/api/projects';
  import { apiKeysAPI, type ApiKey, type ApiKeyType } from '$lib/api/api-keys';
  import { firstSignalAPI } from '$lib/api/first-signal';
  import { toastStore } from '$lib/stores/toast';
  import { getApiUrl } from '$lib/config';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import Switch from '$lib/components/ui/switch/switch.svelte';
  import CreateApiKeyDialog from '$lib/components/CreateApiKeyDialog.svelte';
  import { CreateReceiverDialog, ReceiverEventsDialog } from '$lib/components/receivers';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import SettingsSection from '$lib/components/app/SettingsSection.svelte';
  import DangerZone from '$lib/components/app/DangerZone.svelte';
  import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
  import DataTable from '$lib/components/app/DataTable.svelte';
  import type { DataTableColumn } from '$lib/components/app/data-table';
  import CopyButton from '$lib/components/app/CopyButton.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import { ConnectSnippets } from '$lib/components/connect';
  import { buildDsn, resolveEndpoints } from '$lib/components/connect/endpoints';
  import {
    receiversAPI,
    type Receiver,
    type ReceiverAdapterType,
    type ReceiverFieldMapping,
  } from '$lib/api/receivers';
  import { PROJECT_TRASH_DIALOG_TEXT, PROJECT_TRASH_TOAST } from '$lib/utils/project-trash';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Plus from '@lucide/svelte/icons/plus';
  import ScrollText from '@lucide/svelte/icons/scroll-text';

  let project = $state<any>(null);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state('');
  let showTrashDialog = $state(false);
  let lastLoadedKey = $state<string | null>(null);

  let name = $state('');
  let description = $state('');

  let apiKeys = $state<ApiKey[]>([]);
  let loadingApiKeys = $state(false);
  let showCreateApiKeyDialog = $state(false);
  let apiKeyToDelete = $state<ApiKey | null>(null);
  let lastLoadedApiKeysKey = $state<string | null>(null);
  // Full key of the key created in this visit. Memory only: the server never
  // returns it again, so it is gone when the page is left.
  let sessionKey = $state<string | null>(null);

  let receivers = $state<Receiver[]>([]);
  let loadingReceivers = $state(false);
  let showCreateReceiverDialog = $state(false);
  let receiverToDelete = $state<Receiver | null>(null);
  let eventsReceiver = $state<Receiver | null>(null);
  let showEventsDialog = $state(false);
  let lastLoadedReceiversKey = $state<string | null>(null);

  let lastEventAt = $state<string | null>(null);
  let lastEventLoaded = $state(false);
  let lastLoadedSignalKey: string | null = null;

  const projectId = $derived(page.params.id);

  const endpoints = $derived(
    resolveEndpoints(getApiUrl(), typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  );
  const endpointRows = $derived([
    { label: 'API URL', value: endpoints.apiUrl || endpoints.ingestUrl.replace(/\/api\/v1\/ingest$/, '') },
    { label: 'Ingest URL', value: endpoints.ingestUrl },
    { label: 'OTLP logs URL', value: endpoints.otlpLogsUrl },
    { label: 'OTLP traces URL', value: endpoints.otlpTracesUrl },
    { label: 'OTLP metrics URL', value: endpoints.otlpMetricsUrl },
    { label: 'DSN template', value: buildDsn(endpoints, null) },
  ]);

  const sections = [
    { id: 'general', label: 'General' },
    { id: 'connect', label: 'Connect' },
    { id: 'api-keys', label: 'API keys' },
    { id: 'inbound-webhooks', label: 'Inbound webhooks' },
    { id: 'danger-zone', label: 'Danger zone' },
  ];

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
      error = e instanceof Error ? e.message : 'Could not load the project';
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

    sessionKey = null;
    loadApiKeys();
  });

  $effect(() => {
    if (!browser || !projectId) {
      receivers = [];
      lastLoadedReceiversKey = null;
      return;
    }

    if (projectId === lastLoadedReceiversKey) return;

    loadReceivers();
  });

  // Compact "Last event" line: one cheap read of the project's data flags.
  $effect(() => {
    if (!browser || !projectId) return;
    if (projectId === lastLoadedSignalKey) return;
    lastLoadedSignalKey = projectId;
    lastEventAt = null;
    lastEventLoaded = false;
    const id = projectId;
    firstSignalAPI
      .get(id)
      .then((signal) => {
        if (id !== projectId) return;
        lastEventAt = signal.lastEventAt;
      })
      .catch(() => {
        // The line is a convenience; a failed read just shows nothing special.
      })
      .finally(() => {
        if (id === projectId) lastEventLoaded = true;
      });
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
        description: description.trim() || null,
      } as any);

      toastStore.success('Project updated');
      await loadProject();
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Could not update the project');
    } finally {
      saving = false;
    }
  }

  async function handleTrash() {
    if (!$currentOrganization || !projectId) return;

    try {
      await projectsAPI.deleteProject($currentOrganization.id, projectId);

      toastStore.success(PROJECT_TRASH_TOAST);
      goto('/dashboard/projects');
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Could not move the project to the trash');
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
      toastStore.error(e instanceof Error ? e.message : 'Could not load API keys');
    } finally {
      loadingApiKeys = false;
    }
  }

  async function handleCreateApiKey(data: { name: string; type: ApiKeyType; allowedOrigins: string[] | null }) {
    if (!projectId) throw new Error('No project ID');

    // Errors (including a capability limit on API keys) propagate to the dialog,
    // which shows the message inline.
    const response = await apiKeysAPI.create(projectId, data);
    sessionKey = response.apiKey;
    toastStore.success('API key created');
    await loadApiKeys();
    return response;
  }

  async function handleDeleteApiKey() {
    if (!projectId || !apiKeyToDelete) return;
    const target = apiKeyToDelete;

    try {
      await apiKeysAPI.delete(projectId, target.id);
      toastStore.success('API key deleted');
      await loadApiKeys();
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Could not delete the API key');
    } finally {
      apiKeyToDelete = null;
    }
  }

  async function loadReceivers() {
    if (!projectId) return;

    loadingReceivers = true;

    try {
      const response = await receiversAPI.list(projectId);
      receivers = response.receivers;
      lastLoadedReceiversKey = projectId;
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Could not load inbound webhooks');
    } finally {
      loadingReceivers = false;
    }
  }

  async function handleCreateReceiver(data: {
    name: string;
    adapterType: ReceiverAdapterType;
    fieldMapping?: ReceiverFieldMapping | null;
  }) {
    if (!projectId) throw new Error('No project ID');

    const response = await receiversAPI.create(projectId, data);
    toastStore.success('Inbound webhook created');
    await loadReceivers();
    return response;
  }

  async function handleToggleReceiver(receiver: Receiver, enabled: boolean) {
    if (!projectId) return;

    try {
      await receiversAPI.update(projectId, receiver.id, { enabled });
      toastStore.success(enabled ? 'Inbound webhook enabled' : 'Inbound webhook disabled');
      await loadReceivers();
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Could not update the inbound webhook');
      await loadReceivers();
    }
  }

  async function handleDeleteReceiver() {
    if (!projectId || !receiverToDelete) return;
    const target = receiverToDelete;

    try {
      await receiversAPI.delete(projectId, target.id);
      toastStore.success('Inbound webhook deleted');
      await loadReceivers();
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Could not delete the inbound webhook');
    } finally {
      receiverToDelete = null;
    }
  }

  function openReceiverEvents(receiver: Receiver) {
    eventsReceiver = receiver;
    showEventsDialog = true;
  }

  function adapterLabel(type: ReceiverAdapterType): string {
    if (type === 'github') return 'GitHub';
    if (type === 'uptime') return 'Uptime';
    return 'Generic JSON';
  }

  const hasChanges = $derived(
    project && (name !== project.name || description !== (project.description || ''))
  );

  // Template snippets are typed against the compiler's Snippet; DataTable wants svelte's.
  const asCell = <T,>(snippet: unknown) => snippet as DataTableColumn<T>['cell'];

  const keyColumns = $derived<DataTableColumn<ApiKey>[]>([
    { key: 'name', header: 'Name', cell: asCell<ApiKey>(keyNameCell) },
    { key: 'prefix', header: 'Prefix', cell: asCell<ApiKey>(keyPrefixCell) },
    { key: 'type', header: 'Type', cell: asCell<ApiKey>(keyTypeCell) },
    { key: 'origins', header: 'Origins', cell: asCell<ApiKey>(keyOriginsCell) },
    { key: 'created', header: 'Created', cell: asCell<ApiKey>(keyCreatedCell) },
    { key: 'lastUsed', header: 'Last used', cell: asCell<ApiKey>(keyLastUsedCell) },
    { key: 'actions', header: 'Actions', class: 'text-right', cell: asCell<ApiKey>(keyActionsCell) },
  ]);

  const receiverColumns = $derived<DataTableColumn<Receiver>[]>([
    { key: 'name', header: 'Name', cell: asCell<Receiver>(receiverNameCell) },
    { key: 'source', header: 'Source', cell: asCell<Receiver>(receiverSourceCell) },
    { key: 'enabled', header: 'Enabled', cell: asCell<Receiver>(receiverEnabledCell) },
    { key: 'lastReceived', header: 'Last received', cell: asCell<Receiver>(receiverLastCell) },
    { key: 'actions', header: 'Actions', class: 'text-right', cell: asCell<Receiver>(receiverActionsCell) },
  ]);
</script>

<svelte:head>
  <title>Project settings - LogTide</title>
</svelte:head>

{#snippet keyNameCell(k: ApiKey)}
  <span class="font-medium">{k.name}</span>
{/snippet}

{#snippet keyPrefixCell(k: ApiKey)}
  {#if k.keyPrefix}
    <code class="font-mono text-xs">{k.keyPrefix}...</code>
  {:else}
    <span class="text-xs text-muted-foreground">Created before 1.6</span>
  {/if}
{/snippet}

{#snippet keyTypeCell(k: ApiKey)}
  {#if k.type === 'full'}
    <span class="inline-flex items-center rounded-full border border-transparent bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">
      Full access
    </span>
  {:else}
    <span class="inline-flex items-center rounded-full border border-transparent bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">
      Write-only
    </span>
  {/if}
{/snippet}

{#snippet keyOriginsCell(k: ApiKey)}
  <span class="text-sm text-muted-foreground">
    {#if k.allowedOrigins?.length}
      <span class="cursor-help" title={k.allowedOrigins.join(', ')}>{k.allowedOrigins.length} restricted</span>
    {:else}
      Any
    {/if}
  </span>
{/snippet}

{#snippet keyCreatedCell(k: ApiKey)}
  <span class="text-sm text-muted-foreground"><Timestamp value={k.createdAt} /></span>
{/snippet}

{#snippet keyLastUsedCell(k: ApiKey)}
  <span class="text-sm text-muted-foreground">
    {#if k.lastUsed}<Timestamp value={k.lastUsed} />{:else}Never{/if}
  </span>
{/snippet}

{#snippet keyActionsCell(k: ApiKey)}
  <Button
    variant="ghost"
    size="sm"
    aria-label="Delete API key {k.name}"
    onclick={() => (apiKeyToDelete = k)}
    class="gap-2 text-destructive-text hover:text-destructive-text"
  >
    <Trash2 class="h-4 w-4" aria-hidden="true" />
    Delete
  </Button>
{/snippet}

{#snippet receiverNameCell(r: Receiver)}
  <span class="font-medium">{r.name}</span>
{/snippet}

{#snippet receiverSourceCell(r: Receiver)}
  <span class="inline-flex items-center rounded-full border border-transparent bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">
    {adapterLabel(r.adapterType)}
  </span>
{/snippet}

{#snippet receiverEnabledCell(r: Receiver)}
  <Switch
    checked={r.enabled}
    aria-label="Enable inbound webhook {r.name}"
    onCheckedChange={(checked) => handleToggleReceiver(r, checked)}
  />
{/snippet}

{#snippet receiverLastCell(r: Receiver)}
  <span class="text-sm text-muted-foreground">
    {#if r.lastReceivedAt}<Timestamp value={r.lastReceivedAt} />{:else}Never{/if}
  </span>
{/snippet}

{#snippet receiverActionsCell(r: Receiver)}
  <div class="flex justify-end gap-1">
    <Button variant="ghost" size="sm" aria-label="View events for {r.name}" onclick={() => openReceiverEvents(r)} class="gap-2">
      <ScrollText class="h-4 w-4" aria-hidden="true" />
      Events
    </Button>
    <Button
      variant="ghost"
      size="sm"
      aria-label="Delete inbound webhook {r.name}"
      onclick={() => (receiverToDelete = r)}
      class="gap-2 text-destructive-text hover:text-destructive-text"
    >
      <Trash2 class="h-4 w-4" aria-hidden="true" />
      Delete
    </Button>
  </div>
{/snippet}

<div class="space-y-8">
  {#if loading && !project}
    <div class="flex items-center justify-center py-12">
      <Spinner />
      <span class="ml-3 text-muted-foreground">Loading settings...</span>
    </div>
  {:else if error}
    <EmptyState variant="error" title="Could not load the project" description={error}>
      {#snippet actions()}
        <Button href="/dashboard/projects" variant="outline">Back to projects</Button>
      {/snippet}
    </EmptyState>
  {:else if project}
    <PageHeader
      title="Project settings"
      appliesTo="project"
      breadcrumbs={[
        { label: 'Projects', href: '/dashboard/projects' },
        { label: project.name },
        { label: 'Settings' },
      ]}
    />

    <nav aria-label="Settings sections" class="-mt-4 flex flex-wrap gap-x-4 gap-y-1 border-b border-border pb-2 text-sm">
      {#each sections as section (section.id)}
        <a href="#{section.id}" class="text-muted-foreground hover:text-foreground hover:underline">
          {section.label}
        </a>
      {/each}
    </nav>

    <div id="general" class="scroll-mt-20">
      <SettingsSection title="General" description="Update your project name and description">
        <div class="space-y-4">
          <div class="space-y-2">
            <Label for="name">Project name</Label>
            <Input id="name" type="text" placeholder="My project" bind:value={name} disabled={saving} />
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
              Save changes
            </Button>
          </div>

          <dl class="grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-3">
            <div class="space-y-1">
              <dt class="text-muted-foreground">Project ID</dt>
              <dd class="flex items-center gap-1">
                <code class="break-all font-mono text-xs">{project.id}</code>
                <CopyButton value={project.id} ariaLabel="Copy project ID" />
              </dd>
            </div>
            <div class="space-y-1">
              <dt class="text-muted-foreground">Created</dt>
              <dd><Timestamp value={project.createdAt} /></dd>
            </div>
            <div class="space-y-1">
              <dt class="text-muted-foreground">Last updated</dt>
              <dd><Timestamp value={project.updatedAt} /></dd>
            </div>
          </dl>
        </div>
      </SettingsSection>
    </div>

    <div id="connect" class="scroll-mt-20">
      <SettingsSection
        title="Connect"
        description="Endpoints and ready-to-copy snippets for sending data to this project"
      >
        <div class="space-y-6">
          <p class="text-sm text-muted-foreground" aria-live="polite">
            {#if !lastEventLoaded}
              Checking for data...
            {:else if lastEventAt}
              Last event: <Timestamp value={lastEventAt} relative />
            {:else}
              Last event: no data received yet
            {/if}
          </p>

          <dl class="grid gap-2 text-sm">
            {#each endpointRows as row (row.label)}
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <dt class="w-36 shrink-0 text-muted-foreground">{row.label}</dt>
                <dd class="flex min-w-0 flex-1 items-center gap-1">
                  <code class="break-all font-mono text-xs">{row.value}</code>
                  <CopyButton value={row.value} ariaLabel="Copy {row.label}" />
                </dd>
              </div>
            {/each}
          </dl>

          {#if sessionKey}
            <div class="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-text" role="status">
              The snippets below use the key you just created. It is shown once: copy it now, it is gone when you leave this page.
            </div>
          {/if}

          <ConnectSnippets apiKey={sessionKey} service={project.slug ?? 'my-app'} />
        </div>
      </SettingsSection>
    </div>

    <div id="api-keys" class="scroll-mt-20">
      <SettingsSection title="API keys" description="Manage API keys for sending data to this project">
        <div class="space-y-4">
          <div class="flex justify-end">
            <Button onclick={() => (showCreateApiKeyDialog = true)} class="gap-2">
              <Plus class="h-4 w-4" aria-hidden="true" />
              Create API key
            </Button>
          </div>
          <DataTable columns={keyColumns} rows={apiKeys} rowKey={(k: ApiKey) => k.id} loading={loadingApiKeys}>
            {#snippet empty()}
              <div class="space-y-1 py-4">
                <p>No API keys yet</p>
                <p class="text-sm">Create your first API key to start sending data</p>
              </div>
            {/snippet}
          </DataTable>
        </div>
      </SettingsSection>
    </div>

    <div id="inbound-webhooks" class="scroll-mt-20">
      <SettingsSection
        title="Inbound webhooks"
        description="Receive events from external systems (CI/CD, uptime monitors) as log entries"
      >
        <div class="space-y-4">
          <div class="flex justify-end">
            <Button onclick={() => (showCreateReceiverDialog = true)} class="gap-2">
              <Plus class="h-4 w-4" aria-hidden="true" />
              Create inbound webhook
            </Button>
          </div>
          <DataTable
            columns={receiverColumns}
            rows={receivers}
            rowKey={(r: Receiver) => r.id}
            loading={loadingReceivers}
          >
            {#snippet empty()}
              <div class="space-y-1 py-4">
                <p>No inbound webhooks yet</p>
                <p class="text-sm">Create an inbound webhook to ingest events from external tools</p>
              </div>
            {/snippet}
          </DataTable>
        </div>
      </SettingsSection>
    </div>

    <div id="danger-zone" class="scroll-mt-20">
      <DangerZone>
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="max-w-xl">
            <h3 class="font-medium">Move project to trash</h3>
            <p class="text-sm text-muted-foreground">{PROJECT_TRASH_DIALOG_TEXT(project.name)}</p>
          </div>
          <Button variant="destructive" onclick={() => (showTrashDialog = true)}>Move to trash</Button>
        </div>
      </DangerZone>
    </div>
  {/if}
</div>

<CreateApiKeyDialog bind:open={showCreateApiKeyDialog} onSubmit={handleCreateApiKey} />

<CreateReceiverDialog bind:open={showCreateReceiverDialog} onSubmit={handleCreateReceiver} />

<ReceiverEventsDialog bind:open={showEventsDialog} projectId={projectId ?? ''} receiver={eventsReceiver} />

<ConfirmDialog
  bind:open={() => receiverToDelete !== null, (v) => { if (!v) receiverToDelete = null; }}
  title="Delete inbound webhook"
  description="Delete {receiverToDelete?.name ?? 'this inbound webhook'}? Its webhook URL stops working immediately and cannot be restored."
  confirmLabel="Delete inbound webhook"
  onConfirm={handleDeleteReceiver}
/>

<ConfirmDialog
  bind:open={() => apiKeyToDelete !== null, (v) => { if (!v) apiKeyToDelete = null; }}
  title="Delete API key"
  description="Delete {apiKeyToDelete?.name ?? 'this API key'}? Applications using this key stop sending data. This cannot be undone."
  confirmLabel="Delete API key"
  onConfirm={handleDeleteApiKey}
/>

<ConfirmDialog
  bind:open={showTrashDialog}
  title="Move project to trash"
  description={PROJECT_TRASH_DIALOG_TEXT(project?.name ?? 'This project')}
  confirmLabel="Move to trash"
  requireText={project?.name}
  onConfirm={handleTrash}
/>
