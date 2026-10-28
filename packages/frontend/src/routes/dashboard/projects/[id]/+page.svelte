<script lang="ts">
  import { page } from '$app/state';
  import { currentOrganization } from '$lib/stores/organization';
  import { projectPageStore } from '$lib/stores/project-page';
  import ProjectHealthSection from '$lib/components/projects/ProjectHealthSection.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Skeleton from '$lib/components/ui/skeleton/skeleton.svelte';
  import Button from '$lib/components/ui/button/button.svelte';

  const projectId = $derived(page.params.id);
  const pageState = $derived($projectPageStore);
  const current = $derived(pageState.projectId === projectId);
  const health = $derived(current ? pageState.health : null);
  const loading = $derived(!current || pageState.loading);
  const canManage = $derived($currentOrganization?.role === 'owner' || $currentOrganization?.role === 'admin');
</script>

<div class="space-y-3" data-testid="project-health-page">
  <div class="space-y-1">
    <h2 class="text-lg font-semibold">Health</h2>
    <p class="text-sm text-muted-foreground">
      Checks run every 5 minutes. Open issues also notify your channels.
    </p>
  </div>

  {#if loading}
    <div class="space-y-3" aria-busy="true">
      <Skeleton class="h-16 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>
  {:else if health && projectId}
    <ProjectHealthSection
      {projectId}
      organizationId={$currentOrganization?.id ?? null}
      {health}
      {canManage}
      onChanged={() => projectPageStore.reloadHealth(projectId)}
    />
  {:else if projectId}
    <EmptyState
      variant="error"
      title="Health is not available"
      description={pageState.healthError ?? 'Health checks are not running for this project.'}
    >
      {#snippet actions()}
        <Button variant="outline" size="sm" onclick={() => projectPageStore.load(projectId)}>Retry</Button>
      {/snippet}
    </EmptyState>
  {/if}
</div>
