<script lang="ts">
  import { untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { shortcutsStore } from '$lib/stores/shortcuts';
  import { currentOrganization } from '$lib/stores/organization';
  import { orgProjectsStore } from '$lib/stores/org-projects';
  import { scopeStore } from '$lib/stores/scope';
  import { formatKey } from '$lib/utils/keyboard';
  import * as Command from '$lib/components/ui/command';
  import FileText from '@lucide/svelte/icons/file-text';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import Bug from '@lucide/svelte/icons/bug';
  import { registerDefaultPaletteProviders } from '$lib/components/shell/palette/providers';
  import { loadPaletteGroups, listPaletteProviders } from '$lib/components/shell/palette/registry';
  import { resolveTraceTarget } from '$lib/components/shell/palette/trace-target';
  import type { PaletteGroup, PaletteItem } from '$lib/components/shell/palette/types';

  let open = $state(false);
  let query = $state('');
  let groups = $state<PaletteGroup[]>([]);

  let trimmedQuery = $derived(query.trim());
  // Trace/span IDs are 16 or 32 lowercase hex characters.
  let looksLikeTraceId = $derived(/^[0-9a-f]{16}$|^[0-9a-f]{32}$/i.test(trimmedQuery));
  let organizationId = $derived($currentOrganization?.id ?? null);

  let sortedGroups = $derived.by(() => {
    const order = new Map(listPaletteProviders().map((p) => [p.id, p.order]));
    return groups
      .filter((g) => g.items.length > 0)
      .sort((a, b) => (order.get(a.provider) ?? 1000) - (order.get(b.provider) ?? 1000));
  });

  $effect(() => {
    const unsubscribe = shortcutsStore.subscribe((s) => {
      open = s.commandPaletteOpen;
    });
    return unsubscribe;
  });

  // Entity data loads only while the palette is open, per organization. Closing
  // or switching organization aborts the load and drops what was shown.
  $effect(() => {
    if (!open) {
      groups = [];
      return;
    }
    const org = organizationId;
    groups = [];

    const controller = new AbortController();
    const scopeProjects = untrack(() => scopeStore.get().projectIds);

    registerDefaultPaletteProviders();
    if (org && get(orgProjectsStore).orgId !== org) {
      void orgProjectsStore.load(org);
    }

    void loadPaletteGroups(
      {
        organizationId: org,
        projectId: scopeProjects.length === 1 ? scopeProjects[0] : null,
        signal: controller.signal,
      },
      (group) => {
        if (controller.signal.aborted) return;
        groups = [...groups.filter((g) => g.provider !== group.provider), group];
      }
    );

    return () => controller.abort();
  });

  function handleOpenChange(newOpen: boolean) {
    if (newOpen) {
      shortcutsStore.openCommandPalette();
    } else {
      query = '';
      shortcutsStore.closeCommandPalette();
    }
  }

  function close() {
    query = '';
    shortcutsStore.closeCommandPalette();
  }

  function navigate(href: string) {
    goto(href);
    close();
  }

  function selectItem(item: PaletteItem) {
    if (item.href) {
      navigate(item.href);
    } else {
      item.onSelect?.();
      close();
    }
  }

  function openTrace(traceId: string) {
    const state = get(orgProjectsStore);
    const { projectId } = resolveTraceTarget(traceId, {
      scopeProjectIds: scopeStore.get().projectIds,
      tracesProjectIds: [...state.withTraces],
      allProjectIds: state.projects.map((p) => p.id),
    });
    if (projectId) {
      navigate(`/dashboard/traces/${encodeURIComponent(traceId)}?project=${encodeURIComponent(projectId)}`);
    } else {
      navigate(`/dashboard/traces?traceId=${encodeURIComponent(traceId)}`);
    }
  }

  function itemValue(group: PaletteGroup, item: PaletteItem): string {
    return [group.heading, item.label, ...(item.keywords ?? []), item.id].join(' ');
  }
</script>

<Command.Dialog bind:open onOpenChange={handleOpenChange}>
  <Command.Input placeholder="Type a command or search" bind:value={query} />
  <Command.List>
    <Command.Empty>No results found</Command.Empty>

    {#if trimmedQuery}
      <Command.Group heading="Search">
        {#if looksLikeTraceId}
          <Command.Item value={`open trace ${trimmedQuery}`} onSelect={() => openTrace(trimmedQuery)}>
            <GitBranch class="w-4 h-4 mr-2 text-muted-foreground" />
            <span>Open trace <span class="font-mono">{trimmedQuery}</span></span>
          </Command.Item>
        {/if}
        <Command.Item value={`search logs ${trimmedQuery}`} onSelect={() => navigate(`/dashboard/logs?q=${encodeURIComponent(trimmedQuery)}`)}>
          <FileText class="w-4 h-4 mr-2 text-muted-foreground" />
          <span>Search logs for "{trimmedQuery}"</span>
        </Command.Item>
        <Command.Item value={`search errors ${trimmedQuery}`} onSelect={() => navigate(`/dashboard/errors?search=${encodeURIComponent(trimmedQuery)}`)}>
          <Bug class="w-4 h-4 mr-2 text-muted-foreground" />
          <span>Search errors for "{trimmedQuery}"</span>
        </Command.Item>
      </Command.Group>

      <Command.Separator />
    {/if}

    {#each sortedGroups as group, index (group.provider)}
      {#if index > 0}
        <Command.Separator />
      {/if}
      <Command.Group heading={group.heading}>
        {#each group.items as item (item.id)}
          {@const Icon = item.icon}
          <Command.Item value={itemValue(group, item)} onSelect={() => selectItem(item)}>
            {#if Icon}
              <Icon class="w-4 h-4 mr-2 shrink-0 text-muted-foreground" />
            {/if}
            <span class="truncate">{item.label}</span>
            {#if item.description}
              <span class="ml-2 truncate text-xs text-muted-foreground">{item.description}</span>
            {/if}
            {#if item.shortcut}
              <Command.Shortcut>{formatKey(item.shortcut)}</Command.Shortcut>
            {/if}
          </Command.Item>
        {/each}
      </Command.Group>
    {/each}
  </Command.List>
</Command.Dialog>
