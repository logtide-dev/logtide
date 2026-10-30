<script lang="ts">
  import type { PipelineStep, PreviewResult } from '$lib/api/log-pipeline';
  import { logPipelineAPI } from '$lib/api/log-pipeline';
  import { logsAPI } from '$lib/api/logs';
  import { projectsAPI } from '$lib/api/projects';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import FlaskConical from '@lucide/svelte/icons/flask-conical';
  import CheckCircle from '@lucide/svelte/icons/check-circle';
  import AlertCircle from '@lucide/svelte/icons/alert-circle';

  interface Props {
    organizationId: string;
    steps: PipelineStep[];
    projectId?: string | null;
  }
  let { organizationId, steps, projectId = null }: Props = $props();

  // Org-wide pipelines have no project of their own, so the preview offers
  // a picker to choose which project's recent logs to sample from.
  let projectOptions = $state<{ id: string; name: string }[]>([]);
  let pickedProjectId = $state('');
  let effectiveProjectId = $derived(projectId ?? (pickedProjectId || null));

  let recentLogs = $state<{ id: string; message: string }[] | null>(null);
  let loadingRecent = $state(false);
  let recentError = $state<string | null>(null);
  let selectedRecent = $state('');

  $effect(() => {
    if (projectId || !organizationId) return;
    projectsAPI
      .getProjects(organizationId)
      .then((res) => {
        projectOptions = res.projects.map((p) => ({ id: p.id, name: p.name }));
      })
      .catch(() => {
        projectOptions = [];
      });
  });

  async function loadRecentLogs() {
    const pid = effectiveProjectId;
    if (!pid) return;
    loadingRecent = true;
    recentError = null;
    selectedRecent = '';
    try {
      const res = await logsAPI.getLogs({ projectId: pid, limit: 20 });
      recentLogs = res.logs.map((l, i) => ({ id: String(i), message: l.message }));
    } catch (e) {
      recentLogs = null;
      recentError = e instanceof Error ? e.message : 'Could not load recent logs';
    } finally {
      loadingRecent = false;
    }
  }

  function handleRecentChange(e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value;
    selectedRecent = value;
    const log = recentLogs?.find((l) => l.id === value);
    if (log) sampleMessage = log.message;
  }

  function truncate(message: string): string {
    const oneLine = message.replace(/\s+/g, ' ').trim();
    return oneLine.length > 80 ? oneLine.slice(0, 80) + '...' : oneLine;
  }

  let sampleMessage = $state('');
  let result = $state<PreviewResult | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  async function runPreview() {
    if (!sampleMessage.trim()) return;
    loading = true;
    error = null;
    result = null;
    try {
      result = await logPipelineAPI.preview(organizationId, steps, sampleMessage);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Preview failed';
    } finally {
      loading = false;
    }
  }
</script>

<Card>
  <CardHeader>
    <CardTitle class="flex items-center gap-2">
      <FlaskConical class="w-4 h-4" />
      Preview
    </CardTitle>
    <CardDescription>Test your pipeline steps against a sample log message</CardDescription>
  </CardHeader>
  <CardContent class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      {#if !projectId}
        <select
          aria-label="Project for recent logs"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm"
          bind:value={pickedProjectId}
        >
          <option value="">Choose a project</option>
          {#each projectOptions as p (p.id)}
            <option value={p.id}>{p.name}</option>
          {/each}
        </select>
      {/if}
      <Button
        variant="outline"
        onclick={loadRecentLogs}
        disabled={!effectiveProjectId || loadingRecent}
      >
        {loadingRecent ? 'Loading...' : 'Load recent log'}
      </Button>
      {#if recentLogs && recentLogs.length > 0}
        <select
          aria-label="Recent logs"
          class="h-9 min-w-0 max-w-full flex-1 rounded-md border border-input bg-background px-3 text-sm"
          value={selectedRecent}
          onchange={handleRecentChange}
        >
          <option value="">Choose a recent log</option>
          {#each recentLogs as log (log.id)}
            <option value={log.id}>{truncate(log.message)}</option>
          {/each}
        </select>
      {/if}
    </div>
    {#if recentLogs && recentLogs.length === 0}
      <p class="text-xs text-muted-foreground">No recent logs in this project</p>
    {/if}
    {#if recentError}
      <p class="text-xs text-destructive-text">{recentError}</p>
    {/if}

    <div class="space-y-2">
      <Label for="preview-input">Sample log message</Label>
      <Textarea
        id="preview-input"
        bind:value={sampleMessage}
        rows={3}
        class="font-mono text-sm"
        placeholder='192.168.1.1 - - [01/Jan/2025:00:00:00 +0000] "GET /api/health HTTP/1.1" 200 42'
        disabled={loading}
      />
    </div>

    <Button
      onclick={runPreview}
      disabled={loading || !sampleMessage.trim() || steps.length === 0}
      class="gap-2"
    >
      {#if loading}
        <Spinner size="sm" />
        Running...
      {:else}
        <FlaskConical class="w-4 h-4" />
        Run preview
      {/if}
    </Button>

    {#if steps.length === 0}
      <p class="text-xs text-muted-foreground">Add at least one step to run a preview.</p>
    {/if}

    {#if error}
      <div class="flex items-start gap-2 text-destructive text-sm p-3 bg-destructive/10 rounded-md">
        <AlertCircle class="w-4 h-4 mt-0.5 flex-shrink-0" />
        {error}
      </div>
    {/if}

    {#if result}
      <div class="space-y-3">
        <!-- Step results -->
        <div class="space-y-2">
          <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Step results</p>
          {#each result.steps as stepResult, i}
            <div class="flex items-start gap-2 p-3 border rounded-md text-sm">
              <div class="flex-shrink-0 mt-0.5">
                {#if stepResult.error}
                  <AlertCircle class="w-4 h-4 text-destructive" />
                {:else}
                  <CheckCircle class="w-4 h-4 text-success-text" />
                {/if}
              </div>
              <div class="flex-1 min-w-0">
                <span class="font-medium">Step {i + 1}</span>
                <span class="text-muted-foreground ml-1">({stepResult.step.type})</span>
                {#if stepResult.error}
                  <p class="text-destructive text-xs mt-0.5">{stepResult.error}</p>
                {:else}
                  <p class="text-muted-foreground text-xs mt-0.5">
                    {Object.keys(stepResult.extracted).length} field(s) extracted
                  </p>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        <!-- Merged output -->
        <div class="space-y-1.5">
          <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Merged output</p>
          <pre class="bg-muted rounded-md p-3 text-xs font-mono overflow-auto max-h-64 whitespace-pre-wrap break-all">{JSON.stringify(result.merged, null, 2)}</pre>
        </div>
      </div>
    {/if}
  </CardContent>
</Card>
