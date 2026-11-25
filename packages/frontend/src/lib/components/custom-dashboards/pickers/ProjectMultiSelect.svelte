<script lang="ts">
  // Multi-project picker: an empty selection means every project (null).
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import type { Project } from '@logtide/shared';
  import * as Popover from '$lib/components/ui/popover';
  import Button from '$lib/components/ui/button/button.svelte';
  import { ProjectsAPI } from '$lib/api/projects';
  import { authStore } from '$lib/stores/auth';
  import { organizationStore } from '$lib/stores/organization';
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';

  interface Props {
    id?: string;
    value: string[] | null;
    onChange: (value: string[] | null) => void;
  }

  let { id, value, onChange }: Props = $props();

  let projects = $state<Project[]>([]);

  onMount(async () => {
    // Best-effort: on failure the selected ids still show as "Selected project".
    try {
      const token = get(authStore).token;
      const orgId = get(organizationStore).currentOrganization?.id;
      if (!token || !orgId) return;
      const api = new ProjectsAPI(() => token);
      projects = (await api.getProjects(orgId)).projects;
    } catch {
      projects = [];
    }
  });

  const selected = $derived(value ?? []);
  const unknownSelected = $derived(selected.filter((pid) => !projects.some((p) => p.id === pid)));
  const label = $derived.by(() => {
    if (selected.length === 0) return 'All projects';
    const names = selected.map((pid) => projects.find((p) => p.id === pid)?.name ?? 'Selected project');
    return names.length <= 2 ? names.join(', ') : `${names.length} projects`;
  });

  function toggle(projectId: string) {
    const next = selected.includes(projectId) ? selected.filter((p) => p !== projectId) : [...selected, projectId];
    onChange(next.length === 0 ? null : next);
  }

  const rowBase = 'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted';
</script>

<Popover.Root>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button {...props} {id} type="button" variant="outline" class="w-full justify-between gap-2 font-normal">
        <span class="min-w-0 flex-1 truncate text-left">{label}</span>
        <ChevronDown class="h-4 w-4 shrink-0 opacity-50" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-[260px] p-2" align="start">
    <div class="max-h-[300px] overflow-y-auto" role="group" aria-label="Projects">
      <button type="button" role="checkbox" aria-checked={selected.length === 0} class={rowBase} onclick={() => onChange(null)}>
        <span class="flex h-4 w-4 items-center justify-center">
          {#if selected.length === 0}<Check class="h-4 w-4" />{/if}
        </span>
        <span>All projects</span>
      </button>
      {#each projects as project (project.id)}
        <button type="button" role="checkbox" aria-checked={selected.includes(project.id)} class={rowBase} onclick={() => toggle(project.id)}>
          <span class="flex h-4 w-4 items-center justify-center rounded-sm border">
            {#if selected.includes(project.id)}<Check class="h-3 w-3" />{/if}
          </span>
          <span class="truncate">{project.name}</span>
        </button>
      {/each}
      {#each unknownSelected as pid (pid)}
        <button type="button" role="checkbox" aria-checked="true" class={rowBase} onclick={() => toggle(pid)}>
          <span class="flex h-4 w-4 items-center justify-center rounded-sm border"><Check class="h-3 w-3" /></span>
          <span class="truncate">Selected project</span>
        </button>
      {/each}
    </div>
  </Popover.Content>
</Popover.Root>
