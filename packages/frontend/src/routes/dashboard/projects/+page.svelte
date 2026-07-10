<script lang="ts">
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import {
    organizationStore,
    currentOrganization,
  } from "$lib/stores/organization";
  import { toastStore } from "$lib/stores/toast";
  import { projectsAPI } from "$lib/api/projects";
  import { organizationsAPI } from "$lib/api/organizations";
  import type { Project, OrganizationWithRole } from "@logtide/shared";
  import Button from "$lib/components/ui/button/button.svelte";
  import { buttonVariants } from "$lib/components/ui/button";
  import Input from "$lib/components/ui/input/input.svelte";
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from "$lib/components/ui/card";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
  } from "$lib/components/ui/alert-dialog";
  import Spinner from "$lib/components/Spinner.svelte";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import CreateOrganizationDialog from "$lib/components/CreateOrganizationDialog.svelte";
  import CreateProjectDialog from "$lib/components/CreateProjectDialog.svelte";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Plus from "@lucide/svelte/icons/plus";
  import SearchIcon from "@lucide/svelte/icons/search";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import FileText from "@lucide/svelte/icons/file-text";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import { layoutStore } from "$lib/stores/layout";

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

  // Create project dialog
  let showCreateProjectDialog = $state(false);

  // Create organization dialog
  let showCreateOrgDialog = $state(false);
  let deletingProjectId = $state<string | null>(null);
  let restoringProjectId = $state<string | null>(null);

  // Search/filter
  let searchQuery = $state("");

  // Split into active and deleted
  let activeProjects = $derived(allProjects.filter((p) => !p.deletedAt));
  let deletedProjects = $derived(allProjects.filter((p) => !!p.deletedAt));

  let filteredActive = $derived(() => {
    if (!searchQuery.trim()) return activeProjects;
    const q = searchQuery.toLowerCase();
    return activeProjects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q)),
    );
  });

  let filteredDeleted = $derived(() => {
    if (!searchQuery.trim()) return deletedProjects;
    const q = searchQuery.toLowerCase();
    return deletedProjects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q)),
    );
  });

  function formatDate(dateStr: string | Date): string {
    const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // Reload projects when organization changes
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

  async function handleCreateProject(data: {
    name: string;
    description?: string;
  }) {
    if (!$currentOrganization) {
      throw new Error("Please select an organization first");
    }

    const orgId = $currentOrganization.id;

    try {
      await projectsAPI.createProject({
        organizationId: orgId,
        name: data.name,
        description: data.description,
      });

      toastStore.success(`Project "${data.name}" created successfully!`);
      await loadProjects(orgId);
    } catch (e) {
      const errorMsg =
        e instanceof Error ? e.message : "Failed to create project";
      throw new Error(errorMsg);
    }
  }

  async function deleteProject(id: string) {
    if (!$currentOrganization) return;

    const orgId = $currentOrganization.id;
    deletingProjectId = id;
    error = "";

    try {
      await projectsAPI.deleteProject(orgId, id);
      toastStore.success("Project moved to trash. It will be permanently deleted after 30 days.");
      await loadProjects(orgId);
    } catch (e) {
      const errorMsg =
        e instanceof Error ? e.message : "Failed to delete project";
      error = errorMsg;
      toastStore.error(errorMsg);
    } finally {
      deletingProjectId = null;
    }
  }

  async function restoreProject(id: string) {
    if (!$currentOrganization) return;

    const orgId = $currentOrganization.id;
    restoringProjectId = id;
    error = "";

    try {
      await projectsAPI.restoreProject(orgId, id);
      toastStore.success("Project restored successfully.");
      await loadProjects(orgId);
    } catch (e) {
      const errorMsg =
        e instanceof Error ? e.message : "Failed to restore project";
      error = errorMsg;
      toastStore.error(errorMsg);
    } finally {
      restoringProjectId = null;
    }
  }

  async function handleCreateOrganization(data: {
    name: string;
    description?: string;
  }) {
    try {
      const response = await organizationsAPI.createOrganization(data);
      const newOrgWithRole: OrganizationWithRole = {
        ...response.organization,
        role: "owner",
      };
      organizationStore.addOrganization(newOrgWithRole);
      organizationStore.setCurrentOrganization(newOrgWithRole);
      toastStore.success(`Organization "${data.name}" created successfully!`);
    } catch (e) {
      const errorMsg =
        e instanceof Error ? e.message : "Failed to create organization";
      toastStore.error(errorMsg);
      throw e;
    }
  }
</script>

<svelte:head>
  <title>Dashboard - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
  <div class="space-y-6">
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Projects</h1>
        {#if browser}
          <p class="text-muted-foreground mt-2">
            {$currentOrganization?.name} • {activeProjects.length}
            {activeProjects.length === 1 ? "project" : "projects"}
            {#if deletedProjects.length > 0}
              • {deletedProjects.length} deleted
            {/if}
          </p>
        {:else}
          <p class="text-muted-foreground mt-2">Loading...</p>
        {/if}
      </div>
      <Button onclick={() => (showCreateProjectDialog = true)} size="lg">
        <Plus class="w-5 h-5 mr-2" />
        New Project
      </Button>
    </div>

    {#if error}
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    {/if}

    {#if !loading && allProjects.length > 0}
      <div class="w-full">
        <Input
          type="search"
          placeholder="Search projects by name or description..."
          bind:value={searchQuery}
        />
      </div>
    {/if}

    {#if loading}
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {#each Array(6) as _}
          <Skeleton class="h-36 rounded-lg" />
        {/each}
      </div>
    {:else if activeProjects.length === 0 && deletedProjects.length === 0}
      <Card class="border-2 border-dashed">
        <CardContent class="py-16 text-center">
          <div
            class="w-16 h-16 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center"
          >
            <FolderOpen class="w-8 h-8 text-primary" />
          </div>
          <h3 class="text-xl font-semibold mb-2">No projects yet</h3>
          <p class="text-muted-foreground mb-6 max-w-md mx-auto">
            Get started by creating your first project to organize and monitor
            your application logs
          </p>
          <Button onclick={() => (showCreateProjectDialog = true)} size="lg">
            <Plus class="w-5 h-5 mr-2" />
            Create Your First Project
          </Button>
        </CardContent>
      </Card>
    {:else if filteredActive().length === 0 && filteredDeleted().length === 0}
      <Card>
        <CardContent class="py-16 text-center">
          <div
            class="w-16 h-16 mx-auto mb-6 rounded-full bg-muted flex items-center justify-center"
          >
            <SearchIcon class="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 class="text-xl font-semibold mb-2">No projects found</h3>
          <p class="text-muted-foreground mb-4">
            No projects match your search criteria
          </p>
          <Button variant="outline" onclick={() => (searchQuery = "")}
            >Clear search</Button
          >
        </CardContent>
      </Card>
    {:else}
      <!-- Active projects -->
      {#if filteredActive().length > 0}
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {#each filteredActive() as project}
            <Card class="hover:border-primary/50 transition-colors">
              <CardHeader>
                <div class="flex items-start justify-between">
                  <div class="flex-1">
                    <CardTitle class="text-lg">{project.name}</CardTitle>
                    {#if project.description}
                      <CardDescription class="mt-1.5"
                        >{project.description}</CardDescription
                      >
                    {/if}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div class="space-y-4">
                  <div class="text-xs text-muted-foreground">
                    Created {formatDate(project.createdAt)}
                  </div>
                  <div class="flex gap-2">
                    <a
                      href="/dashboard/projects/{project.id}/overview"
                      class={buttonVariants({
                        variant: "outline",
                        size: "sm",
                      }) + " flex-1"}
                      onclick={(e) => e.stopPropagation()}
                    >
                      View Project
                    </a>
                    <Button
                      variant="outline"
                      size="sm"
                      onclick={() => goto(`/dashboard/search?project=${project.id}`)}
                      class="gap-1"
                    >
                      <FileText class="w-4 h-4" />
                      Logs
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger>
                        {#snippet child({ props })}
                          <Button
                            {...props}
                            variant="destructive"
                            size="sm"
                            disabled={deletingProjectId === project.id}
                            class="gap-2"
                          >
                            {#if deletingProjectId === project.id}
                              <Spinner size="sm" />
                            {:else}
                              <Trash2 class="w-4 h-4" />
                            {/if}
                          </Button>
                        {/snippet}
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Project?</AlertDialogTitle>
                          <AlertDialogDescription>
                            "{project.name}" will be moved to trash. Historical
                            logs, traces and metrics remain accessible for 30 days,
                            after which they are permanently deleted.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onclick={() => deleteProject(project.id)}
                          >
                            Move to Trash
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardContent>
            </Card>
          {/each}
        </div>
      {/if}

      <!-- Deleted projects -->
      {#if filteredDeleted().length > 0}
        <div class="space-y-3">
          <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Deleted
          </h2>
          <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {#each filteredDeleted() as project}
              <Card class="opacity-70 border-dashed">
                <CardHeader>
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <CardTitle class="text-lg truncate">{project.name}</CardTitle>
                        <span class="shrink-0 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          Deleted
                        </span>
                      </div>
                      {#if project.description}
                        <CardDescription class="mt-1.5"
                          >{project.description}</CardDescription
                        >
                      {/if}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div class="space-y-4">
                    <div class="text-xs text-muted-foreground">
                      Deleted {formatDate(project.deletedAt!)}
                    </div>
                    <div class="flex gap-2">
                      <a
                        href="/dashboard/projects/{project.id}/overview"
                        class={buttonVariants({
                          variant: "outline",
                          size: "sm",
                        }) + " flex-1"}
                        onclick={(e) => e.stopPropagation()}
                      >
                        View Logs
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
                          Restore
                        {/if}
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

<CreateOrganizationDialog
  bind:open={showCreateOrgDialog}
  onSubmit={handleCreateOrganization}
/>

<CreateProjectDialog
  bind:open={showCreateProjectDialog}
  onSubmit={handleCreateProject}
/>
