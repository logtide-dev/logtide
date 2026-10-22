<script lang="ts">
  import { page } from "$app/state";
  import { currentOrganization } from "$lib/stores/organization";
  import { orgProjectsStore } from "$lib/stores/org-projects";
  import { readScopeFromUrl } from "$lib/stores/scope-url";
  import OrganizationSwitcher from "$lib/components/OrganizationSwitcher.svelte";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import FolderKanban from "@lucide/svelte/icons/folder-kanban";

  // Load the project list of the active organization once per organization, so
  // the project part of the breadcrumb can show a name instead of an id.
  $effect(() => {
    const orgId = $currentOrganization?.id;
    if (!orgId) return;
    if ($orgProjectsStore.orgId !== orgId) {
      void orgProjectsStore.load(orgId);
    }
  });

  const PROJECT_ROUTE = /^\/dashboard\/projects\/([^/]+)/;

  // The project shown after the organization: the route id on project pages,
  // else the single project selected by the URL scope. Two or more projects
  // (or none) show the organization only.
  let projectId = $derived.by(() => {
    const url = page.url;
    const routeMatch = PROJECT_ROUTE.exec(url.pathname);
    if (routeMatch) return decodeURIComponent(routeMatch[1]);
    const ids = readScopeFromUrl(url).projectIds ?? [];
    return ids.length === 1 ? ids[0] : null;
  });

  // Unknown to the active organization (stale id after a switch) means no project part.
  let project = $derived.by(() => {
    if (!projectId) return null;
    if ($orgProjectsStore.orgId !== $currentOrganization?.id) return null;
    return $orgProjectsStore.projects.find((p) => p.id === projectId) ?? null;
  });
</script>

<nav aria-label="Breadcrumb" class="flex items-center gap-1 min-w-0">
  <OrganizationSwitcher variant="breadcrumb" />
  {#if project}
    <ChevronRight class="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
    <a
      href="/dashboard/projects/{encodeURIComponent(project.id)}/overview"
      data-breadcrumb-project
      title={project.name}
      class="inline-flex items-center gap-1.5 min-w-0 max-w-[10rem] rounded-md px-2 py-1 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <FolderKanban class="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
      <span class="truncate">{project.name}</span>
    </a>
  {/if}
</nav>
