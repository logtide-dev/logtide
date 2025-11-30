<script lang="ts">
  import { browser } from "$app/environment";
  import {
    organizationStore,
    currentOrganization,
  } from "$lib/stores/organization";
  import { toastStore } from "$lib/stores/toast";
  import { projectsAPI } from "$lib/api/projects";
  import { organizationsAPI } from "$lib/api/organizations";
  import type { Project, OrganizationWithRole } from "@logward/shared";
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
  import CreateOrganizationDialog from "$lib/components/CreateOrganizationDialog.svelte";
  import CreateProjectDialog from "$lib/components/CreateProjectDialog.svelte";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Plus from "@lucide/svelte/icons/plus";
  import SearchIcon from "@lucide/svelte/icons/search";
  import Trash2 from "@lucide/svelte/icons/trash-2";

  let projects = $state<Project[]>([]);
  let filteredProjects = $state<Project[]>([]);
  let loading = $state(false);
  let error = $state("");
  let lastLoadedOrgId = $state<string | null>(null);

  // Create project dialog
  let showCreateProjectDialog = $state(false);

  // Create organization dialog
  let showCreateOrgDialog = $state(false);
  let deletingProjectId = $state<string | null>(null);

  // Search/filter
  let searchQuery = $state("");

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // Filter projects based on search query
  $effect(() => {
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filteredProjects = projects.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          (p.description && p.description.toLowerCase().includes(query)),
      );
    } else {
      filteredProjects = projects;
    }
  });

  // Reload projects when organization changes
  $effect(() => {
    if (!browser || !$currentOrganization) {
      projects = [];
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
      const response = await projectsAPI.getProjects(orgId);
      projects = response.projects;
      lastLoadedOrgId = orgId;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load projects";
      toastStore.error(error);
      // Don't set lastLoadedOrgId on error to allow retry
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
      toastStore.success("Project deleted successfully");
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
  <title>Dashboard - LogWard</title>
</svelte:head>

<div class="container mx-auto px-6 py-8 max-w-7xl">
  <div class="space-y-6">
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Projects</h1>
        {#if browser}
          <p class="text-muted-foreground mt-2">
            {$currentOrganization?.name} • {projects.length}
            {projects.length === 1 ? "project" : "projects"}
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

    {#if !loading && projects.length > 0}
      <div class="w-full">
        <Input
          type="search"
          placeholder="Search projects by name or description..."
          bind:value={searchQuery}
        />
      </div>
    {/if}

    {#if loading}
      <div class="flex flex-col items-center justify-center py-16">
        <Spinner size="lg" className="text-primary mb-4" />
        <p class="text-muted-foreground">Loading projects...</p>
      </div>
    {:else if projects.length === 0}
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
    {:else if filteredProjects.length === 0}
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
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {#each filteredProjects as project}
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
                    href="/dashboard/projects/{project.id}"
                    class={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    }) + " flex-1"}
                    onclick={(e) => e.stopPropagation()}
                  >
                    View Project
                  </a>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      {#snippet trigger(props)}
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
                          This action cannot be undone. This will permanently
                          delete the project "{project.name}" and all associated
                          logs.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onclick={() => deleteProject(project.id)}
                        >
                          Delete Project
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
