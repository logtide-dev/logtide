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
  import Spinner from "$lib/components/Spinner.svelte";
  import PageHeader from "$lib/components/app/PageHeader.svelte";
  import EmptyState from "$lib/components/app/EmptyState.svelte";
  import CreateProjectDialog from "$lib/components/CreateProjectDialog.svelte";
  import ProjectsTable, { type HealthFilter } from "$lib/components/projects/ProjectsTable.svelte";
  import QuotaNearLimitBanner from "$lib/components/projects/QuotaNearLimitBanner.svelte";
  import { projectHealthStore } from "$lib/stores/project-health";
  import type { ProjectStats } from "$lib/api/projects";
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
  let healthFilter = $state<HealthFilter>("all");

  // Per-project numbers come from one batched call and never block the list:
  // null means "not loaded / failed" and the cells render a dash.
  let stats = $state<Record<string, ProjectStats> | null>(null);

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

    // Last event, health and stats never block the table; cells degrade without them.
    void orgProjectsStore.load(orgId);
    void projectHealthStore.load(orgId);
    stats = null;
    projectsAPI
      .getStats(orgId)
      .then((res) => {
        if ($currentOrganization?.id === orgId) stats = res.projects ?? {};
      })
      .catch(() => {
        if ($currentOrganization?.id === orgId) stats = null;
      });

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

  let storesFresh = $derived($orgProjectsStore.orgId === $currentOrganization?.id);
  let lastEventAt = $derived(storesFresh ? $orgProjectsStore.lastEventAt : {});
  let receiving = $derived(storesFresh ? $orgProjectsStore.receiving : new Set<string>());
  let healthByProject = $derived(
    $projectHealthStore.orgId === $currentOrganization?.id ? $projectHealthStore.byProject : {},
  );

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
    {#if $currentOrganization}
      <QuotaNearLimitBanner organizationId={$currentOrganization.id} role={$currentOrganization.role} />
    {/if}

    {#if !loading && allProjects.length > 0}
      <div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="search"
          placeholder="Search projects by name or description"
          aria-label="Search projects"
          bind:value={searchQuery}
          class="sm:max-w-md"
        />
        <select
          aria-label="Filter by health"
          class="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          bind:value={healthFilter}
        >
          <option value="all">All</option>
          <option value="problems">With problems</option>
          <option value="inactive">Inactive</option>
          <option value="no_data">No data</option>
        </select>
      </div>
    {/if}

    {#if loading}
      <div data-testid="projects-skeleton">
        <ProjectsTable
          projects={[]}
          loading={true}
          stats={null}
          health={{}}
          lastEventAt={{}}
          receiving={new Set()}
        />
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
        <ProjectsTable
          projects={filteredActive}
          {stats}
          health={healthByProject}
          {lastEventAt}
          {receiving}
          {healthFilter}
        >
          {#snippet empty()}
            No projects match this health filter.
          {/snippet}
        </ProjectsTable>
      {/if}

      {#if filteredDeleted.length > 0}
        <div class="space-y-3">
          <h2 class="text-sm font-semibold text-muted-foreground">Deleted projects</h2>
          <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {#each filteredDeleted as project (project.id)}
              <Card class="opacity-70 border-dashed flex h-full flex-col" data-testid="deleted-project-card">
                <CardHeader>
                  <div class="flex items-center gap-2">
                    <CardTitle class="text-lg truncate">{project.name}</CardTitle>
                    <span class="shrink-0 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      Deleted
                    </span>
                  </div>
                  {#if project.description}
                    <CardDescription class="mt-1.5 line-clamp-2" title={project.description}>{project.description}</CardDescription>
                  {/if}
                </CardHeader>
                <CardContent class="mt-auto">
                  <div class="space-y-4">
                    <p class="text-xs text-muted-foreground" data-testid="purge-date">
                      Permanently deleted on {purgeDate(project)}
                    </p>
                    <div class="flex gap-2">
                      <a
                        href="/dashboard/projects/{project.id}"
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
