<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import type { Project } from '@logtide/shared';
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '$lib/components/ui/select';
  import { ProjectsAPI } from '$lib/api/projects';
  import { authStore } from '$lib/stores/auth';
  import { organizationStore } from '$lib/stores/organization';

  interface Props {
    id?: string;
    value: string | null;
    onChange: (value: string | null) => void;
  }

  let { id, value, onChange }: Props = $props();

  let projects = $state<Project[]>([]);

  onMount(async () => {
    // Best-effort: on failure only "All projects" and the current value remain.
    try {
      const token = get(authStore).token;
      const orgId = get(organizationStore).currentOrganization?.id;
      if (!token || !orgId) return;
      const api = new ProjectsAPI(() => token);
      const response = await api.getProjects(orgId);
      projects = response.projects;
    } catch {
      projects = [];
    }
  });

  const label = $derived(
    value === null
      ? 'All projects'
      : (projects.find((p) => p.id === value)?.name ?? 'Selected project')
  );
</script>

<Select
  type="single"
  value={value ?? '__all__'}
  onValueChange={(v) => {
    if (!v) return;
    onChange(v === '__all__' ? null : v);
  }}
>
  <SelectTrigger {id}>
    <SelectValue>{label}</SelectValue>
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="__all__">All projects</SelectItem>
    {#each projects as project (project.id)}
      <SelectItem value={project.id}>{project.name}</SelectItem>
    {/each}
    {#if value !== null && !projects.some((p) => p.id === value)}
      <SelectItem value={value}>Selected project</SelectItem>
    {/if}
  </SelectContent>
</Select>
