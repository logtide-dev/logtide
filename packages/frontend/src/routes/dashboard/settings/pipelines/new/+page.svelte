<script lang="ts">
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { organizationStore } from '$lib/stores/organization';
  import { toastStore } from '$lib/stores/toast';
  import { pipelineStore } from '$lib/stores/log-pipeline';
  import type { PipelineStep } from '$lib/api/log-pipeline';
  import { logPipelineAPI } from '$lib/api/log-pipeline';
  import { projectsAPI } from '$lib/api/projects';
  import type { Project } from '@logtide/shared';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import ReadOnlyNotice from '$lib/components/settings/ReadOnlyNotice.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Switch } from '$lib/components/ui/switch';
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog';
  import StepBuilder from '$lib/components/pipelines/StepBuilder.svelte';
  import PipelinePreview from '$lib/components/pipelines/PipelinePreview.svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Upload from '@lucide/svelte/icons/upload';

  let token: string | null = null;
  let organizationId = $state<string | null>(null);
  let role = $state<string | null>(null);
  let canEdit = $derived(role === 'owner' || role === 'admin');
  let projects = $state<Project[]>([]);
  let projectId = $state<string | null>(null);

  let name = $state('');
  let description = $state('');
  let enabled = $state(true);
  let steps = $state<PipelineStep[]>([]);
  let saving = $state(false);

  let importDialogOpen = $state(false);
  let importYaml = $state('');
  let importing = $state(false);

  authStore.subscribe((s) => {
    token = s.token;
  });

  organizationStore.subscribe((s) => {
    organizationId = s.currentOrganization?.id ?? null;
    role = s.currentOrganization?.role ?? null;
  });

  $effect(() => {
    if (!token) { goto('/login'); return; }
    if (organizationId) {
      projectsAPI.getProjects(organizationId).then((res) => { projects = res.projects; });
    }
  });

  async function handleCreate() {
    if (!organizationId) return;
    if (!name.trim()) {
      toastStore.error('Enter a pipeline name');
      return;
    }
    saving = true;
    try {
      await pipelineStore.create(organizationId, {
        name: name.trim(),
        description: description.trim() || undefined,
        steps,
        enabled,
        projectId: projectId ?? undefined,
      });
      toastStore.success('Pipeline created');
      goto('/dashboard/settings/pipelines');
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Could not create pipeline');
    } finally {
      saving = false;
    }
  }

  async function handleImport() {
    if (!organizationId || !importYaml.trim()) return;
    importing = true;
    try {
      const pipeline = await logPipelineAPI.importYaml(organizationId, null, importYaml);
      toastStore.success('Pipeline imported');
      importDialogOpen = false;
      goto('/dashboard/settings/pipelines');
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Could not import pipeline');
    } finally {
      importing = false;
    }
  }
</script>

<svelte:head>
  <title>New pipeline - LogTide</title>
</svelte:head>

<div class="space-y-6">
  <PageHeader
    title="New pipeline"
    appliesTo="organization"
    description="Define parsing and enrichment steps for your logs."
    breadcrumbs={[
      { label: 'Pipelines', href: '/dashboard/settings/pipelines' },
      { label: 'New pipeline' },
    ]}
  >
    {#snippet actions()}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Back to pipelines"
        onclick={() => goto('/dashboard/settings/pipelines')}
      >
        <ArrowLeft class="w-4 h-4" />
      </Button>
      {#if canEdit}
        <Button variant="outline" class="gap-2" onclick={() => (importDialogOpen = true)}>
          <Upload class="w-4 h-4" />
          Import pipeline from YAML
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  {#if !canEdit}
    <ReadOnlyNotice what="log pipelines" />
  {/if}

  <!-- Basic Info -->
  <Card>
    <CardHeader>
      <CardTitle>Basic info</CardTitle>
    </CardHeader>
    <CardContent class="space-y-4">
      <div class="space-y-2">
        <Label for="pipeline-name">Name *</Label>
        <Input
          id="pipeline-name"
          type="text"
          placeholder="nginx-access-logs"
          bind:value={name}
          disabled={saving}
        />
      </div>
      <div class="space-y-2">
        <Label for="pipeline-desc">Description</Label>
        <Textarea
          id="pipeline-desc"
          placeholder="Parse nginx access log format and enrich with GeoIP data"
          bind:value={description}
          disabled={saving}
          rows={2}
        />
      </div>
      <div class="space-y-2">
        <Label for="pipeline-project">Project <span class="text-muted-foreground text-xs">(optional, leave empty for an organization-wide default)</span></Label>
        <select
          id="pipeline-project"
          class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
          onchange={(e) => { projectId = (e.currentTarget as HTMLSelectElement).value || null; }}
          disabled={saving || !canEdit}
        >
          <option value="">All projects (organization-wide)</option>
          {#each projects as p}
            <option value={p.id}>{p.name}</option>
          {/each}
        </select>
      </div>
      <div class="flex items-center gap-3">
        <Switch bind:checked={enabled} disabled={saving} />
        <span class="text-sm">{enabled ? 'Enabled' : 'Disabled'}</span>
      </div>
    </CardContent>
  </Card>

  <!-- Steps -->
  <Card>
    <CardHeader>
      <CardTitle>Pipeline steps</CardTitle>
      <CardDescription>
        Steps are executed in order. Each step can parse or enrich log data.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <StepBuilder {steps} onChange={(s) => { steps = s; }} />
    </CardContent>
  </Card>

  <!-- Preview -->
  {#if organizationId}
    <PipelinePreview {organizationId} {steps} {projectId} />
  {/if}

  <!-- Actions -->
  <div class="flex items-center justify-end gap-3">
    <Button
      variant="outline"
      onclick={() => goto('/dashboard/settings/pipelines')}
      disabled={saving}
    >
      Cancel
    </Button>
    <Button onclick={handleCreate} disabled={saving || !name.trim() || !canEdit}>
      {saving ? 'Creating...' : 'Create pipeline'}
    </Button>
  </div>
</div>

<!-- Import YAML Dialog -->
<Dialog bind:open={importDialogOpen}>
  <DialogContent class="max-w-lg">
    <DialogHeader>
      <DialogTitle>Import pipeline from YAML</DialogTitle>
      <DialogDescription>
        Paste your pipeline YAML definition below to import it.
      </DialogDescription>
    </DialogHeader>
    <div class="space-y-3">
      <Textarea
        placeholder="name: my-pipeline&#10;steps:&#10;  - type: parser&#10;    parser: nginx"
        bind:value={importYaml}
        rows={12}
        class="font-mono text-sm"
        disabled={importing}
      />
    </div>
    <DialogFooter>
      <Button
        variant="outline"
        onclick={() => { importDialogOpen = false; importYaml = ''; }}
        disabled={importing}
      >
        Cancel
      </Button>
      <Button onclick={handleImport} disabled={importing || !importYaml.trim()} class="gap-2">
        <Upload class="w-4 h-4" />
        {importing ? 'Importing...' : 'Import'}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
