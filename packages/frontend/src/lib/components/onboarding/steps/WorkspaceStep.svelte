<script lang="ts">
  import { get } from 'svelte/store';
  import { onboardingStore } from '$lib/stores/onboarding';
  import { authStore } from '$lib/stores/auth';
  import { organizationStore } from '$lib/stores/organization';
  import { OrganizationsAPI } from '$lib/api/organizations';
  import { projectsAPI } from '$lib/api/projects';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import Spinner from '$lib/components/Spinner.svelte';
  import Building2 from '@lucide/svelte/icons/building-2';

  const PROJECT_SUGGESTIONS = ['Production', 'Staging', 'Development'];
  const PERSONAL_DOMAINS = ['gmail', 'hotmail', 'yahoo', 'outlook'];

  const organizationsAPI = new OrganizationsAPI(() => get(authStore).token);

  const storedOrganizationId = $derived($onboardingStore.organizationId);

  let orgName = $state('');
  let projectName = $state('Production');
  let submitting = $state(false);
  let errorMessage = $state('');

  const orgSuggestions = $derived.by(() => {
    const email = $authStore.user?.email ?? '';
    const match = email.match(/@([^.]+)\./);
    const domain = match ? match[1] : '';
    if (!domain || PERSONAL_DOMAINS.includes(domain)) {
      return ['My company', 'My team', 'Personal projects'];
    }
    const name = domain.charAt(0).toUpperCase() + domain.slice(1);
    return [name, `${name} engineering`];
  });

  const canSubmit = $derived(
    projectName.trim().length > 0 && (storedOrganizationId !== null || orgName.trim().length > 0)
  );

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (submitting || !canSubmit) return;
    submitting = true;
    errorMessage = '';

    try {
      let organizationId = get(onboardingStore).organizationId;

      if (!organizationId) {
        const created = await organizationStore.createOrganization(async () => {
          const response = await organizationsAPI.createOrganization({ name: orgName.trim() });
          return { ...response.organization, role: 'owner' as const };
        });
        organizationId = created.id;
        // Stored right away: if the project call fails the retry creates only the project.
        await onboardingStore.setWorkspace({ organizationId });
      }

      const { project } = await projectsAPI.createProject({
        organizationId,
        name: projectName.trim(),
      });
      await onboardingStore.setWorkspace({
        organizationId,
        projectId: project.id,
        projectName: project.name,
      });
      await onboardingStore.goToStep('connect');
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Could not create the workspace';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="space-y-6">
  <div class="space-y-2 text-center">
    <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
      <Building2 class="h-8 w-8 text-primary-text" aria-hidden="true" />
    </div>
    <h2 class="text-2xl font-bold">Set up your workspace</h2>
    <p class="mx-auto max-w-md text-muted-foreground">
      An organization groups your team. A project holds the logs, traces and metrics of one
      application or environment. You can add more later.
    </p>
  </div>

  <form onsubmit={handleSubmit} class="space-y-5 rounded-lg border bg-card p-6">
    {#if errorMessage}
      <Alert variant="destructive">
        <AlertDescription>{errorMessage}</AlertDescription>
      </Alert>
    {/if}

    {#if storedOrganizationId}
      <p class="text-sm text-muted-foreground">
        Your organization is ready. Create the first project to continue.
      </p>
    {:else}
      <div class="space-y-2">
        <Label for="org-name">Organization name</Label>
        <Input
          id="org-name"
          type="text"
          placeholder="Acme Corp"
          bind:value={orgName}
          disabled={submitting}
        />
        <div class="flex flex-wrap gap-2">
          {#each orgSuggestions as suggestion (suggestion)}
            <button
              type="button"
              class="rounded-md border bg-background px-3 py-1 text-sm transition-colors hover:bg-accent"
              onclick={() => (orgName = suggestion)}
            >
              {suggestion}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <div class="space-y-2">
      <Label for="project-name">First project name</Label>
      <Input id="project-name" type="text" bind:value={projectName} disabled={submitting} />
      <div class="flex flex-wrap gap-2">
        {#each PROJECT_SUGGESTIONS as suggestion (suggestion)}
          <button
            type="button"
            class="rounded-md border bg-background px-3 py-1 text-sm transition-colors hover:bg-accent"
            onclick={() => (projectName = suggestion)}
          >
            {suggestion}
          </button>
        {/each}
      </div>
    </div>

    <Button type="submit" class="w-full gap-2" disabled={submitting || !canSubmit}>
      {#if submitting}
        <Spinner size="sm" />
        Creating...
      {:else}
        Create workspace
      {/if}
    </Button>
  </form>
</div>
