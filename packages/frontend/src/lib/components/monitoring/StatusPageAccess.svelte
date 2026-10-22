<script lang="ts">
  import type { Project } from '@logtide/shared';
  import { ProjectsAPI } from '$lib/api/projects';
  import { getAuthToken } from '$lib/utils/auth';
  import { toastStore } from '$lib/stores/toast';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';

  interface Props {
    orgId: string;
    orgSlug: string;
    project: Project;
    onProjectChanged: (p: Project) => void;
  }

  let { orgId, orgSlug, project, onProjectChanged }: Props = $props();

  const projectsAPI = new ProjectsAPI(getAuthToken);

  const VISIBILITY_OPTIONS = [
    { value: 'disabled', label: 'Disabled' },
    { value: 'public', label: 'Public' },
    { value: 'password', label: 'Password protected' },
    { value: 'members_only', label: 'Members only' },
  ];

  let password = $state('');
  let saving = $state(false);
  let slugInput = $state('');
  let slugError = $state<string | null>(null);
  let savingSlug = $state(false);

  $effect(() => {
    slugInput = project.slug ?? '';
    slugError = null;
  });

  async function updateVisibility(visibility: string) {
    if (visibility === project.statusPageVisibility) return;
    saving = true;
    try {
      const input: Record<string, unknown> = { statusPageVisibility: visibility };
      if (visibility === 'password' && password) input.statusPagePassword = password;
      const res = await projectsAPI.updateProject(orgId, project.id, input as never);
      onProjectChanged({ ...project, statusPageVisibility: res.project.statusPageVisibility });
      const label = VISIBILITY_OPTIONS.find((o) => o.value === visibility)?.label ?? visibility;
      toastStore.success(`Status page set to ${label.toLowerCase()}`);
      if (visibility !== 'password') password = '';
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Could not update the status page');
    } finally {
      saving = false;
    }
  }

  async function savePassword() {
    if (!password) return;
    saving = true;
    try {
      await projectsAPI.updateProject(orgId, project.id, {
        statusPageVisibility: 'password',
        statusPagePassword: password,
      } as never);
      toastStore.success('Password updated');
      password = '';
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Could not update the password');
    } finally {
      saving = false;
    }
  }

  async function saveSlug() {
    if (!slugInput) return;
    slugError = null;
    savingSlug = true;
    try {
      const res = await projectsAPI.updateProject(orgId, project.id, { slug: slugInput });
      onProjectChanged({ ...project, slug: res.project.slug });
      toastStore.success('Slug updated');
    } catch (err) {
      slugError = err instanceof Error ? err.message : 'Could not update the slug';
    } finally {
      savingSlug = false;
    }
  }
</script>

<section class="space-y-3 rounded-lg border bg-card px-4 py-4" aria-labelledby="sp-access-heading">
  <h3 id="sp-access-heading" class="text-sm font-semibold">Access</h3>

  <div class="flex flex-wrap items-center gap-3">
    <Label for="sp-visibility">Visibility</Label>
    <select
      id="sp-visibility"
      value={project.statusPageVisibility}
      disabled={saving}
      onchange={(e) => updateVisibility((e.currentTarget as HTMLSelectElement).value)}
      class="h-9 w-48 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {#each VISIBILITY_OPTIONS as opt (opt.value)}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
  </div>

  {#if project.statusPageVisibility === 'password'}
    <div class="flex flex-wrap items-center gap-2">
      <Label for="sp-password" class="sr-only">Status page password</Label>
      <Input
        id="sp-password"
        type="password"
        bind:value={password}
        placeholder="Set or update password"
        class="w-64"
        autocomplete="new-password"
      />
      <Button size="sm" disabled={!password || saving} onclick={savePassword}>Save password</Button>
    </div>
  {/if}

  {#if project.statusPageVisibility !== 'disabled'}
    <div class="space-y-1.5">
      <Label for="sp-slug">Public URL slug</Label>
      <div class="flex flex-wrap items-center gap-2">
        <span class="whitespace-nowrap text-xs text-muted-foreground">/status/{orgSlug}/</span>
        <Input id="sp-slug" bind:value={slugInput} placeholder="project-slug" class="w-48" />
        <Button
          size="sm"
          disabled={!slugInput || slugInput === project.slug || savingSlug}
          onclick={saveSlug}
        >
          Save slug
        </Button>
      </div>
      {#if slugError}<p class="text-xs text-destructive-text">{slugError}</p>{/if}
    </div>
  {/if}
</section>
