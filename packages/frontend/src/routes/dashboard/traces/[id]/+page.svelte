<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { currentOrganization } from '$lib/stores/organization';
  import { authStore } from '$lib/stores/auth';
  import { scopeStore } from '$lib/stores/scope';
  import { layoutStore } from '$lib/stores/layout';
  import { ProjectsAPI } from '$lib/api/projects';
  import TraceView from '$lib/components/traces/TraceView.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { resolveTraceProject } from '$lib/utils/trace-resolve';
  import { traceDetailUrl } from '$lib/utils/trace-links';

  const maxWidthClass = layoutStore.maxWidthClass;
  const containerPadding = layoutStore.containerPadding;

  let token = $state<string | null>(null);
  const unsubAuth = authStore.subscribe((s) => {
    token = s.token;
  });
  $effect(() => unsubAuth);

  const traceId = $derived(page.params.id ?? '');
  const projectId = $derived(
    page.url.searchParams.get('project') || page.url.searchParams.get('projectId') || '',
  );

  let resolving = $state(false);
  let unresolved = $state(false);
  let resolveSeq = 0;

  // No project in the link: find the owning project, never loop.
  $effect(() => {
    const id = traceId;
    const hasProject = !!projectId;
    const org = $currentOrganization;
    if (hasProject || !id) {
      unresolved = false;
      resolving = false;
      return;
    }
    if (!org) return;
    untrack(() => resolve(id, org.id));
  });

  async function resolve(id: string, organizationId: string) {
    const seq = ++resolveSeq;
    resolving = true;
    unresolved = false;
    const candidates: string[] = [];
    const scoped = $scopeStore.projectIds[0];
    if (scoped) candidates.push(scoped);
    try {
      const api = new ProjectsAPI(() => token);
      const [res, availability] = await Promise.all([
        api.getProjects(organizationId),
        api.getProjectDataAvailability(organizationId).catch(() => null),
      ]);
      const withTraces = availability?.traces;
      const list =
        withTraces && withTraces.length > 0
          ? res.projects.filter((p) => withTraces.includes(p.id))
          : res.projects;
      candidates.push(...list.map((p) => p.id));
    } catch (e) {
      console.error('Failed to load projects:', e);
    }
    const found = await resolveTraceProject(id, candidates);
    if (seq !== resolveSeq) return;
    resolving = false;
    if (found) {
      await goto(traceDetailUrl(id, found), { replaceState: true });
    } else {
      unresolved = true;
    }
  }
</script>

{#if projectId}
  <TraceView {traceId} {projectId} />
{:else}
  <div class="container mx-auto {$containerPadding} {$maxWidthClass}">
    {#if unresolved}
      <EmptyState
        variant="error"
        title="Trace not found"
        description="No project in your organization has a trace with this id."
      >
        {#snippet actions()}
          <Button variant="outline" size="sm" href="/dashboard/traces">Back to traces</Button>
        {/snippet}
      </EmptyState>
    {:else}
      <div class="flex items-center justify-center py-12"><Spinner size="lg" /></div>
    {/if}
  </div>
{/if}
