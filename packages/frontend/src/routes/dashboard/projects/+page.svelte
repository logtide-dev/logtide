<script lang="ts">
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { currentOrganization } from "$lib/stores/organization";
  import { orgProjectsStore } from "$lib/stores/org-projects";
  import { toastStore } from "$lib/stores/toast";
  import { projectsAPI } from "$lib/api/projects";
  import type { Project } from "@logtide/shared";
  import Button from "$lib/components/ui/button/button.svelte";
  import Input from "$lib/components/ui/input/input.svelte";
  import { buttonVariants } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import Spinner from "$lib/components/Spinner.svelte";
  import PageHeader from "$lib/components/app/PageHeader.svelte";
  import EmptyState from "$lib/components/app/EmptyState.svelte";
  import CreateProjectDialog from "$lib/components/CreateProjectDialog.svelte";
  import ProjectCard from "$lib/components/shell/ProjectCard.svelte";
  import { describeLastEvent } from "$lib/components/shell/last-event";
  import { formatDateShort } from "$lib/utils/datetime";
  import Plus from "@lucide/svelte/icons/plus";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import { layoutStore } from "$lib/stores/layout";

  // Deleted projects are purged this many days after deletion.
  const HARD_DELETE_GRACE_DAYS = 30;

  let allProjects = $state<Project[]>([]);
  let maxWidthClass = $state("max-w-7xl");
  let containerPadding = $state("px-6 py-8");

  $effect(() => {
    const unsubscribe = layoutStore.maxWidthClass.subscribe((value) => {
      maxWidthClass = value;
    });
    return unsubscribe;
  });

  $effect(() => {
    const unsubscribe = layoutStore.containerPadding.subscribe((value) => {
      containerPadding = value;
    });
    return unsubscribe;
  });

  let loading = $state(false);
  let error = $state("");
  let lastLoadedOrgId = $state<string | null>(null);

  let showCreateProjectDialog = $state(false);
  let restoringProjectId = $state<string | null>(null);

  let searchQuery = $state("");

  let activeProjects = $derived(allProjects.filter((p) => !p.deletedAt));
  let deletedProjects = $derived(allProjects.filter((p) => !!p.deletedAt));

  function matches(p: Project, q: string): boolean {
    return (
      p.name.toLowerCase().includes(q) ||
      (!!p.description && p.description.toLowerCase().includes(q))
    );
  }

  let filteredActive = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    return q ? activeProjects.filter((p) => matches(p, q)) : activeProjects;
  });

  let filteredDeleted = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    return q ? deletedProjects.filter((p) => matches(p, q)) : deletedProjects;
  });

  // The create=1 hint (set after creating an organization) opens the dialog once.
  let createHintHandled = false;
  $effect(() => {
    if (!browser || createHintHandled) return;
    if (page.url.searchParams.get("create") === "1") {
      createHintHandled = true;
      showCreateProjectDialog = true;
      goto("/dashboard/projects", { replaceState: true });
    }
  });

  // Reload projects (and the last-event data) when the organization changes
  $effect(() => {
    if (!browser || !$currentOrganization) {
      allProjects = [];
      lastLoadedOrgId = null;
      return;
    }

    const currentOrgId = $currentOrganization.id;
    if (currentOrgId === lastLoadedOrgId) return;

    loadProjects(currentOrgId);
  });

  async function loadProjects(orgId: string) {
    if (loading) return;

    loading = true;
    error = "";

    // Last event data never blocks the grid; cards degrade without it.
    void orgProjectsStore.load(orgId);

    try {
      const response = await projectsAPI.getProjects(orgId, { includeDeleted: true });
      allProjects = response.projects;
      lastLoadedOrgId = orgId;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load projects";
      toastStore.error(error);
    } finally {
      loading = false;
    }
  }

  function statusFor(project: Project) {
    const fresh = $orgProjectsStore.orgId === $currentOrganization?.id;
    return describeLastEvent({
      lastEventAt: fresh ? $orgProjectsStore.lastEventAt[project.id] : null,
      receiving: fresh && $orgProjectsStore.receiving.has(project.id),
    });
  }

  function purgeDate(project: Project): string {
    const d = new Date(project.deletedAt as Date | string);
    d.setDate(d.getDate() + HARD_DELETE_GRACE_DAYS);
    return formatDateShort(d);
  }

  async function handleCreateProject(data: { name: string; description?: string }) {
    if (!$currentOrganization) {
      throw new Error("Select an organization first");
    }

    try {
      const { project } = await projectsAPI.createProject({
        organizationId: $currentOrganization.id,
        name: data.name,
        description: data.description,
      });

      toastStore.success(`Project "${data.name}" created`);
      goto(`/dashboard/projects/${project.id}/settings#connect`);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : "Failed to create project";
      throw new Error(errorMsg);
    }
  }

  async function restoreProject(id: string) {
    if (!$currentOrganization) return;

    const orgId = $currentOrganization.id;
    restoringProjectId = id;
    error = "";

    try {
      await projectsAPI.restoreProject(orgId, id);
      toastStore.success("Project restored");
      await loadProjects(orgId);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : "Failed to restore project";
      error = errorMsg;
      toastStore.error(errorMsg);
    } finally {
      restoringProjectId = null;
    }
  }

  function retry() {
    if ($currentOrganization) {
      loadProjects($currentOrganization.id);
    }
  }
</script>

<svelte:head>
  <title>Projects - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
  <PageHeader
    title="Projects"
    description={browser && $currentOrganization
      ? `${$currentOrganization.name} - ${activeProjects.length} ${activeProjects.length === 1 ? "project" : "projects"}${deletedProjects.length > 0 ? `, ${deletedProjects.length} deleted` : ""}`
      : undefined}
  >
    {#snippet actions()}
      <Button onclick={() => (showCreateProjectDialog = true)}>
        <Plus class="w-4 h-4 mr-2" />
        New project
      </Button>
    {/snippet}
  </PageHeader>

  <div class="space-y-6">
    {#if !loading && allProjects.length > 0}
      <div class="w-full">
        <Input
          type="search"
          placeholder="Search projects by name or description"
          aria-label="Search projects"
          bind:value={searchQuery}
        />
      </div>
    {/if}

    {#if loading}
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="projects-skeleton">
        {#each Array(6) as _}
          <Skeleton class="h-36 rounded-lg" />
        {/each}
      </div>
    {:else if error && allProjects.length === 0}
      <EmptyState variant="error" title="Could not load projects" description={error}>
        {#snippet actions()}
          <Button onclick={retry}>Retry</Button>
        {/snippet}
      </EmptyState>
    {:else if activeProjects.length === 0 && deletedProjects.length === 0}
      <EmptyState
        variant="setup"
        title="Create your first project"
        description="A project holds the logs, traces and metrics of one application. Create one, then connect your app to start sending data."
      >
        {#snippet actions()}
          <Button onclick={() => (showCreateProjectDialog = true)}>
            <Plus class="w-4 h-4 mr-2" />
            Create project
          </Button>
        {/snippet}
      </EmptyState>
    {:else if filteredActive.length === 0 && filteredDeleted.length === 0}
      <EmptyState
        variant="no-results"
        title="No projects found"
        description="No projects match your search."
      >
        {#snippet actions()}
          <Button variant="outline" onclick={() => (searchQuery = "")}>Clear search</Button>
        {/snippet}
      </EmptyState>
    {:else}
      {#if filteredActive.length > 0}
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {#each filteredActive as project (project.id)}
            <ProjectCard {project} status={statusFor(project)} />
          {/each}
        </div>
      {/if}

      {#if filteredDeleted.length > 0}
        <div class="space-y-3">
          <h2 class="text-sm font-semibold text-muted-foreground">Deleted projects</h2>
          <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {#each filteredDeleted as project (project.id)}
              <Card class="opacity-70 border-dashed" data-testid="deleted-project-card">
                <CardHeader>
                  <div class="flex items-center gap-2">
                    <CardTitle class="text-lg truncate">{project.name}</CardTitle>
                    <span class="shrink-0 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      Deleted
                    </span>
                  </div>
                  {#if project.description}
                    <CardDescription class="mt-1.5">{project.description}</CardDescription>
                  {/if}
                </CardHeader>
                <CardContent>
                  <div class="space-y-4">
                    <p class="text-xs text-muted-foreground" data-testid="purge-date">
                      Permanently deleted on {purgeDate(project)}
                    </p>
                    <div class="flex gap-2">
                      <a
                        href="/dashboard/projects/{project.id}/overview"
                        class="{buttonVariants({ variant: 'outline', size: 'sm' })} flex-1"
                      >
                        View project
                      </a>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={restoringProjectId === project.id}
                        onclick={() => restoreProject(project.id)}
                        class="gap-1"
                      >
                        {#if restoringProjectId === project.id}
                          <Spinner size="sm" />
                        {:else}
                          <RotateCcw class="w-4 h-4" />
                        {/if}
                        Restore
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>

<CreateProjectDialog
  bind:open={showCreateProjectDialog}
  onSubmit={handleCreateProject}
/>
