<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { currentOrganization } from "$lib/stores/organization";
  import { orgProjectsStore } from "$lib/stores/org-projects";
  import { scopeStore } from "$lib/stores/scope";
  import { activeScopeBar } from "$lib/stores/scope-bar";
  import { readScopeFromUrl } from "$lib/stores/scope-url";
  import OrganizationSwitcher from "$lib/components/OrganizationSwitcher.svelte";
  import { Popover, PopoverContent, PopoverTrigger } from "$lib/components/ui/popover";
  import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
  } from "$lib/components/ui/command";
  import { projectSwitchHref, scopedProjectsHref } from "./project-links";
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import FolderKanban from "@lucide/svelte/icons/folder-kanban";
  import Layers from "@lucide/svelte/icons/layers";
  import LayoutGrid from "@lucide/svelte/icons/layout-grid";
  import SquareArrowOutUpRight from "@lucide/svelte/icons/square-arrow-out-up-right";

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

  let projects = $derived(
    $orgProjectsStore.orgId === $currentOrganization?.id ? $orgProjectsStore.projects : []
  );

  let routeProjectId = $derived.by(() => {
    const match = PROJECT_ROUTE.exec(page.url.pathname);
    return match ? decodeURIComponent(match[1]) : null;
  });

  // What the switcher shows, in sync with the page: the route project on project
  // pages, else the URL scope, else the shared scope (the last pick, or the
  // page fallback). Ids unknown to this organization are dropped.
  let selectedIds = $derived.by(() => {
    const ids = routeProjectId
      ? [routeProjectId]
      : (readScopeFromUrl(page.url).projectIds ?? $scopeStore.projectIds);
    return ids.filter((id) => projects.some((p) => p.id === id));
  });

  // A project page of another organization (stale id after a switch) shows the
  // organization only.
  let visible = $derived(projects.length > 0 && (!routeProjectId || selectedIds.length === 1));

  let single = $derived(
    selectedIds.length === 1 ? (projects.find((p) => p.id === selectedIds[0]) ?? null) : null
  );
  let label = $derived(
    single ? single.name : selectedIds.length === 0 ? "All projects" : `${selectedIds.length} projects`
  );

  // "All projects" is a scope, so it is offered only where the page can show it.
  let allowAll = $derived(!routeProjectId && $activeScopeBar?.mode !== "single");

  let open = $state(false);

  function sameSelection(ids: string[]) {
    return ids.length === selectedIds.length && ids.every((id) => selectedIds.includes(id));
  }

  // The pick is remembered like one made in the page scope bar. Project pages
  // move to the same sub-page of the other project; pages with a project
  // picker get the new scope in the URL so their picker follows.
  function choose(ids: string[]) {
    open = false;
    if (sameSelection(ids)) return;
    scopeStore.setProjects(ids);
    if (routeProjectId) {
      goto(projectSwitchHref(page.url, ids[0]));
    } else if ($activeScopeBar) {
      goto(scopedProjectsHref(page.url, ids), { replaceState: true, keepFocus: true, noScroll: true });
    }
  }

  function openPage(href: string) {
    open = false;
    goto(href);
  }
</script>

<nav aria-label="Breadcrumb" class="flex items-center gap-1 min-w-0">
  <OrganizationSwitcher variant="breadcrumb" />
  {#if visible}
    <ChevronRight class="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
    <Popover bind:open>
      <PopoverTrigger
        data-breadcrumb-project
        role="combobox"
        aria-expanded={open}
        aria-label="Switch project"
        title={label}
        class="inline-flex items-center gap-1.5 min-w-[4rem] max-w-[10rem] rounded-md px-2 py-1 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {#if single}
          <FolderKanban class="hidden sm:block w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
        {:else}
          <Layers class="hidden sm:block w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
        {/if}
        <span class="truncate">{label}</span>
        <ChevronDown class="w-3.5 h-3.5 opacity-50 flex-shrink-0" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent class="w-60 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search projects" />
          <CommandList>
            <CommandEmpty>No project found.</CommandEmpty>
            <CommandGroup heading="Projects">
              {#if allowAll}
                <CommandItem value="all projects" onSelect={() => choose([])} class="cursor-pointer">
                  <div class="flex items-center gap-2 w-full" data-project-option="all">
                    <Layers class="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                    <span class="flex-1 min-w-0 truncate text-sm">All projects</span>
                    {#if selectedIds.length === 0}
                      <Check class="w-4 h-4 text-primary flex-shrink-0" aria-hidden="true" />
                    {/if}
                  </div>
                </CommandItem>
              {/if}
              {#each projects as p (p.id)}
                <CommandItem value={`${p.name} ${p.id}`} onSelect={() => choose([p.id])} class="cursor-pointer">
                  <div class="flex items-center gap-2 w-full" data-project-option={p.id}>
                    <FolderKanban class="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                    <span class="flex-1 min-w-0 truncate text-sm">{p.name}</span>
                    {#if selectedIds.includes(p.id)}
                      <Check class="w-4 h-4 text-primary flex-shrink-0" aria-hidden="true" />
                    {/if}
                  </div>
                </CommandItem>
              {/each}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              {#if single && !routeProjectId}
                <CommandItem
                  value="open project overview"
                  onSelect={() => openPage(`/dashboard/projects/${encodeURIComponent(single.id)}`)}
                  class="cursor-pointer"
                >
                  <div class="flex items-center gap-2 w-full">
                    <SquareArrowOutUpRight class="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                    <span class="text-sm">Open project</span>
                  </div>
                </CommandItem>
              {/if}
              <CommandItem value="manage projects" onSelect={() => openPage("/dashboard/projects")} class="cursor-pointer">
                <div class="flex items-center gap-2 w-full">
                  <LayoutGrid class="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                  <span class="text-sm">Manage projects</span>
                </div>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  {/if}
</nav>
