<script lang="ts">
  import { onDestroy } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import type { TimeRangePreset } from "@logtide/shared";
  import Button from "$lib/components/ui/button/button.svelte";
  import Input from "$lib/components/ui/input/input.svelte";
  import * as Popover from "$lib/components/ui/popover";
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Clock from "@lucide/svelte/icons/clock";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import TimeRangePicker from "$lib/components/TimeRangePicker.svelte";
  import { rangeLabel, zoneLabel } from "$lib/components/time-range/labels";
  import { displayPreferences } from "$lib/stores/display-preferences";
  import {
    reconcileScope,
    scopeStore,
    stripLegacyProject,
    writeScopeToUrl,
    type Scope,
    type TimeRangeValue,
  } from "$lib/stores/scope";

  interface Props {
    mode: "multi" | "single";
    projects: { id: string; name: string }[];
    showProjects?: boolean;
    showTime?: boolean;
    /** Time picker stays visible but cannot be changed (live tail). */
    timeDisabled?: boolean;
    presets?: TimeRangePreset[];
    /**
     * Put the scope in the address bar on mount, so a copied link opens the
     * same view (spec 5.2). Pages that manage their own URL (Logs) turn it off.
     */
    canonicalUrl?: boolean;
  }

  let {
    mode,
    projects,
    showProjects = true,
    showTime = true,
    timeDisabled = false,
    presets,
    canonicalUrl = true,
  }: Props = $props();

  const FILTER_THRESHOLD = 8;

  let projectsOpen = $state(false);
  let filter = $state("");

  let lastCanonical = "";

  // Reconcile the store with the URL and the visible projects. Only what the URL
  // or the user decided is persisted; a page fallback is shown for this page
  // only (UI-1). Then the address bar gets the canonical scope once.
  $effect(() => {
    const result = reconcileScope({
      stored: scopeStore.getPersisted(),
      url: page.url,
      projects,
      mode,
      presets,
      write: { projects: showProjects, range: showTime },
    });
    scopeStore.reconcile(result.commit, result.effective);
    // Wait for the project list, or the first canonical URL would be rewritten
    // again as soon as the projects load.
    const ready = !showProjects || projects.length > 0;
    if (canonicalUrl && ready && result.url && result.url.href !== lastCanonical) {
      lastCanonical = result.url.href;
      goto(result.url, { replaceState: true, keepFocus: true, noScroll: true });
    }
  });

  // Leaving the page drops its fallback, so the next page starts from what was
  // really remembered.
  onDestroy(() => scopeStore.clearEffective());

  function syncUrl() {
    const current = scopeStore.get();
    const parts: Partial<Scope> = {};
    if (showProjects) parts.projectIds = current.projectIds;
    if (showTime) parts.range = current.range;
    goto(stripLegacyProject(writeScopeToUrl(page.url, parts, { explicitAll: true })), {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  }

  let selectedIds = $derived($scopeStore.projectIds);
  let projectLabel = $derived.by(() => {
    if (mode === "single") {
      const hit = projects.find((p) => p.id === selectedIds[0]);
      return hit ? hit.name : "Select project";
    }
    if (selectedIds.length === 0) return "All projects";
    if (selectedIds.length === 1) {
      return projects.find((p) => p.id === selectedIds[0])?.name ?? "1 project";
    }
    return `${selectedIds.length.toLocaleString("en-US")} projects`;
  });

  let visibleProjects = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    return q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;
  });

  function isChecked(id: string): boolean {
    return selectedIds.length === 0 || selectedIds.includes(id);
  }

  function chooseSingle(id: string) {
    scopeStore.setProjects([id]);
    projectsOpen = false;
    syncUrl();
  }

  function chooseAll() {
    scopeStore.setProjects([]);
    syncUrl();
  }

  function toggleMulti(id: string) {
    const all = projects.map((p) => p.id);
    const base = selectedIds.length === 0 ? all : selectedIds;
    let next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    // Nothing selected, or everything selected, both mean "all projects".
    if (next.length === 0 || (all.length > 0 && all.every((x) => next.includes(x)))) next = [];
    scopeStore.setProjects(next);
    syncUrl();
  }

  function handleRange(value: TimeRangeValue) {
    if (timeDisabled) return;
    scopeStore.setRange(value);
    syncUrl();
  }

  // The formatter reads the preferences at call time, so touch the store to
  // re-derive when the zone or the clock changes.
  let zoneText = $derived.by(() => {
    void $displayPreferences;
    return zoneLabel();
  });
  let disabledTimeLabel = $derived.by(() => {
    void $displayPreferences;
    return rangeLabel($scopeStore.range);
  });

  const rowBase =
    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted";
</script>

<div class="flex flex-wrap items-center gap-2">
  {#if showProjects}
    <Popover.Root bind:open={projectsOpen}>
      <Popover.Trigger>
        {#snippet child({ props })}
          <Button {...props} type="button" variant="outline" size="sm" class="gap-2">
            <FolderOpen class="h-4 w-4 text-muted-foreground" />
            <span>{projectLabel}</span>
            <ChevronDown class="h-4 w-4 opacity-50" />
          </Button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Content class="w-[260px] p-2" align="start">
        {#if projects.length > FILTER_THRESHOLD}
          <Input
            type="text"
            placeholder="Filter projects"
            aria-label="Filter projects"
            class="mb-2 h-8"
            bind:value={filter}
          />
        {/if}
        <div
          class="max-h-[300px] overflow-y-auto"
          role={mode === "single" ? "radiogroup" : "group"}
          aria-label="Projects"
        >
          {#if mode === "multi"}
            <button
              type="button"
              role="checkbox"
              aria-checked={selectedIds.length === 0}
              class={rowBase}
              onclick={chooseAll}
            >
              <span class="flex h-4 w-4 items-center justify-center">
                {#if selectedIds.length === 0}<Check class="h-4 w-4" />{/if}
              </span>
              <span>All projects</span>
            </button>
          {/if}
          {#each visibleProjects as project (project.id)}
            {#if mode === "multi"}
              <button
                type="button"
                role="checkbox"
                aria-checked={isChecked(project.id)}
                class={rowBase}
                onclick={() => toggleMulti(project.id)}
              >
                <span class="flex h-4 w-4 items-center justify-center rounded-sm border">
                  {#if isChecked(project.id)}<Check class="h-3 w-3" />{/if}
                </span>
                <span class="truncate">{project.name}</span>
              </button>
            {:else}
              <button
                type="button"
                role="radio"
                aria-checked={selectedIds[0] === project.id}
                class={rowBase}
                onclick={() => chooseSingle(project.id)}
              >
                <span class="flex h-4 w-4 items-center justify-center">
                  {#if selectedIds[0] === project.id}<Check class="h-4 w-4" />{/if}
                </span>
                <span class="truncate">{project.name}</span>
              </button>
            {/if}
          {/each}
          {#if visibleProjects.length === 0}
            <p class="px-2 py-3 text-sm text-muted-foreground">No projects found</p>
          {/if}
        </div>
      </Popover.Content>
    </Popover.Root>
  {/if}

  {#if showTime}
    {#if timeDisabled}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        aria-disabled="true"
        class="gap-2 opacity-60"
      >
        <Clock class="h-4 w-4 text-muted-foreground" />
        <span>{disabledTimeLabel}</span>
      </Button>
    {:else}
      <TimeRangePicker value={$scopeStore.range} onValueChange={handleRange} {presets} />
    {/if}
    <span
      data-testid="scope-zone"
      class="text-xs text-muted-foreground"
      title="Times are shown in this time zone"
    >
      {zoneText}
    </span>
  {/if}
</div>
