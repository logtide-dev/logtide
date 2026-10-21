<script lang="ts">
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { organizationStore } from '$lib/stores/organization';
  import { toastStore } from '$lib/stores/toast';
  import { pipelineStore } from '$lib/stores/log-pipeline';
  import type { Pipeline } from '$lib/api/log-pipeline';
  import { projectsAPI } from '$lib/api/projects';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { Switch } from '$lib/components/ui/switch';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
  import ReadOnlyNotice from '$lib/components/settings/ReadOnlyNotice.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import GitBranch from '@lucide/svelte/icons/git-branch';

  let token: string | null = null;
  let organizationId = $state<string | null>(null);
  let role = $state<string | null>(null);
  let canEdit = $derived(role === 'owner' || role === 'admin');
  let deleteTarget = $state<Pipeline | null>(null);
  let deleteDialogOpen = $state(false);
  let projectNames = $state<Record<string, string>>({});

  authStore.subscribe((s) => {
    token = s.token;
  });

  organizationStore.subscribe((s) => {
    organizationId = s.currentOrganization?.id ?? null;
    role = s.currentOrganization?.role ?? null;
  });

  $effect(() => {
    if (!token) {
      goto('/login');
      return;
    }
    if (organizationId) {
      pipelineStore.load(organizationId);
      projectsAPI
        .getProjects(organizationId)
        .then((res) => {
          projectNames = Object.fromEntries(res.projects.map((p) => [p.id, p.name]));
        })
        .catch(() => {
          projectNames = {};
        });
    }
  });

  function openDeleteDialog(pipeline: Pipeline) {
    deleteTarget = pipeline;
    deleteDialogOpen = true;
  }

  async function handleDelete() {
    if (!deleteTarget || !organizationId) return;
    try {
      await pipelineStore.delete(deleteTarget.id, organizationId);
      toastStore.success('Pipeline deleted');
      deleteTarget = null;
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Could not delete pipeline');
      throw e;
    }
  }

  async function handleToggle(pipeline: Pipeline) {
    if (!organizationId) return;
    try {
      await pipelineStore.toggleEnabled(pipeline, organizationId);
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Could not update pipeline');
    }
  }
</script>

<svelte:head>
  <title>Pipelines - LogTide</title>
</svelte:head>

<PageHeader
  title="Pipelines"
  appliesTo="organization"
  description="Define steps to parse and enrich incoming log messages before they are stored."
/>

<div class="space-y-6">
  {#if !canEdit}
    <ReadOnlyNotice what="log pipelines" />
  {/if}

  <p class="text-sm text-muted-foreground" data-testid="pipeline-precedence">
    A project pipeline runs instead of the organization-wide pipeline for that project. They are not chained.
  </p>

  <Card>
    <CardHeader>
      <div class="flex items-center justify-between">
        <div>
          <CardTitle class="flex items-center gap-2">
            <GitBranch class="w-4 h-4" />
            Log parsing pipelines
          </CardTitle>
          <CardDescription>
            Steps run in order on every log that matches the pipeline.
          </CardDescription>
        </div>
        {#if canEdit}
          <Button onclick={() => goto('/dashboard/settings/pipelines/new')} class="gap-2">
            <Plus class="w-4 h-4" />
            New pipeline
          </Button>
        {/if}
      </div>
    </CardHeader>
    <CardContent>
      {#if $pipelineStore.loading}
        <div class="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span class="ml-2 text-sm text-muted-foreground">Loading pipelines...</span>
        </div>
      {:else if $pipelineStore.error}
        <div class="text-destructive-text text-sm py-4">{$pipelineStore.error}</div>
      {:else if $pipelineStore.pipelines.length === 0}
        <div class="flex flex-col items-center justify-center py-16 text-center gap-4">
          <GitBranch class="w-10 h-10 text-muted-foreground/50" />
          <div>
            <p class="font-medium">No pipelines yet</p>
            <p class="text-sm text-muted-foreground mt-1">
              {canEdit
                ? 'Create your first pipeline to start parsing and enriching logs'
                : 'An organization owner or admin can create pipelines.'}
            </p>
          </div>
          {#if canEdit}
            <Button onclick={() => goto('/dashboard/settings/pipelines/new')} class="gap-2">
              <Plus class="w-4 h-4" />
              Create your first pipeline
            </Button>
          {/if}
        </div>
      {:else}
        <div class="space-y-3">
          {#each $pipelineStore.pipelines as pipeline (pipeline.id)}
            <div class="flex items-center justify-between p-4 border rounded-lg gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-medium truncate">{pipeline.name}</span>
                  {#if pipeline.projectId}
                    <Badge variant="secondary" class="text-xs" data-testid="pipeline-scope">
                      {projectNames[pipeline.projectId] ?? 'Project'}
                    </Badge>
                  {:else}
                    <Badge variant="outline" class="text-xs" data-testid="pipeline-scope">All projects</Badge>
                  {/if}
                  <Badge variant={pipeline.enabled ? 'default' : 'secondary'} class="text-xs">
                    {pipeline.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
                {#if pipeline.description}
                  <p class="text-sm text-muted-foreground mt-1 truncate">{pipeline.description}</p>
                {/if}
                <p class="text-xs text-muted-foreground mt-1">
                  {pipeline.steps.length} step{pipeline.steps.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div class="flex items-center gap-3 flex-shrink-0">
                <Switch
                  checked={pipeline.enabled}
                  disabled={!canEdit}
                  aria-label={`Enable ${pipeline.name}`}
                  onCheckedChange={() => handleToggle(pipeline)}
                />
                {#if canEdit}
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8"
                    onclick={() => goto(`/dashboard/settings/pipelines/${pipeline.id}`)}
                    title="Edit pipeline"
                    aria-label={`Edit ${pipeline.name}`}
                  >
                    <Pencil class="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8 text-destructive hover:text-destructive"
                    onclick={() => openDeleteDialog(pipeline)}
                    title="Delete pipeline"
                    aria-label={`Delete ${pipeline.name}`}
                  >
                    <Trash2 class="w-4 h-4" />
                  </Button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </CardContent>
  </Card>
</div>

<ConfirmDialog
  bind:open={deleteDialogOpen}
  title="Delete pipeline"
  description={`Delete ${deleteTarget?.name ?? 'this pipeline'}? Logs will no longer be parsed by it. This cannot be undone.`}
  confirmLabel="Delete pipeline"
  onConfirm={handleDelete}
/>
