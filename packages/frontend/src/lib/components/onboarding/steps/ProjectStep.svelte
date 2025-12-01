<script lang="ts">
  import { onboardingStore } from '$lib/stores/onboarding';
  import { authStore } from '$lib/stores/auth';
  import { organizationStore } from '$lib/stores/organization';
  import { ProjectsAPI } from '$lib/api/projects';
  import { toastStore } from '$lib/stores/toast';
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { fly } from 'svelte/transition';
  import FolderKanban from '@lucide/svelte/icons/folder-kanban';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Server from '@lucide/svelte/icons/server';
  import Code from '@lucide/svelte/icons/code';
  import TestTube from '@lucide/svelte/icons/test-tube';
  import Globe from '@lucide/svelte/icons/globe';

  let isLoading = $state(false);
  let projectName = $state('');
  let projectDescription = $state('');
  let selectedPreset = $state<string | null>(null);
  let token = $state<string | null>(null);
  let projectsAPI = $derived(new ProjectsAPI(() => token));

  let isFormValid = $derived(projectName.trim().length > 0);

  authStore.subscribe((state) => {
    token = state.token;
  });

  let currentOrgId = $state<string | null>(null);
  organizationStore.subscribe((state) => {
    currentOrgId = state.currentOrganization?.id || null;
  });

  // Environment presets
  const presets = [
    {
      id: 'production',
      icon: Globe,
      name: 'Production',
      description: 'Live production environment',
      suggestion: 'Production'
    },
    {
      id: 'staging',
      icon: Server,
      name: 'Staging',
      description: 'Pre-production testing',
      suggestion: 'Staging'
    },
    {
      id: 'development',
      icon: Code,
      name: 'Development',
      description: 'Local development',
      suggestion: 'Development'
    },
    {
      id: 'testing',
      icon: TestTube,
      name: 'Testing',
      description: 'Automated tests',
      suggestion: 'Testing'
    }
  ];

  function selectPreset(preset: typeof presets[0]) {
    selectedPreset = preset.id;
    projectName = preset.suggestion;
    projectDescription = `Logs from ${preset.name.toLowerCase()} environment`;
  }

  async function handleSubmit() {
    if (!projectName.trim()) {
      toastStore.error('Project name is required');
      return;
    }

    if (!currentOrgId) {
      toastStore.error('No organization selected');
      return;
    }

    isLoading = true;

    try {
      const response = await projectsAPI.createProject({
        organizationId: currentOrgId,
        name: projectName.trim(),
        description: projectDescription.trim() || undefined,
      });

      onboardingStore.setProjectId(response.project.id);
      toastStore.success('Project created!');
      onboardingStore.completeStep('create-project');
    } catch (error: any) {
      console.error('Failed to create project:', error);
      toastStore.error(error.message || 'Failed to create project');
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="space-y-6" in:fly={{ y: 20, duration: 400 }}>
  <div class="text-center space-y-2">
    <div class="w-16 h-16 mx-auto bg-primary/10 rounded-2xl flex items-center justify-center">
      <FolderKanban class="w-8 h-8 text-primary" />
    </div>
    <h2 class="text-2xl font-bold">Create Your First Project</h2>
    <p class="text-muted-foreground max-w-md mx-auto">
      Projects organize your logs by application, service, or environment. Each project gets its own API keys.
    </p>
  </div>

  <!-- Environment presets -->
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
    {#each presets as preset}
      <button
        type="button"
        class="p-4 rounded-lg border text-left transition-all hover:border-primary/50
          {selectedPreset === preset.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'bg-card'}"
        onclick={() => selectPreset(preset)}
      >
        <div class="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center mb-2">
          <preset.icon class="w-4 h-4 text-primary" />
        </div>
        <p class="font-medium text-sm">{preset.name}</p>
        <p class="text-xs text-muted-foreground">{preset.description}</p>
      </button>
    {/each}
  </div>

  <Card>
    <CardHeader>
      <CardTitle class="text-lg">Project Details</CardTitle>
      <CardDescription>
        {selectedPreset ? 'Customize the project name or use the preset' : 'Enter a name for your project'}
      </CardDescription>
    </CardHeader>
    <CardContent>
      <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-4">
        <div class="space-y-2">
          <Label for="project-name">
            Project Name <span class="text-destructive">*</span>
          </Label>
          <Input
            id="project-name"
            type="text"
            placeholder="e.g., My App Production, Backend API"
            bind:value={projectName}
            disabled={isLoading}
            required
          />
        </div>

        <div class="space-y-2">
          <Label for="project-description">Description (optional)</Label>
          <Textarea
            id="project-description"
            placeholder="What application or service will send logs to this project?"
            bind:value={projectDescription}
            disabled={isLoading}
            rows={2}
          />
        </div>

        <Button
          type="submit"
          disabled={isLoading || !isFormValid}
          class="w-full gap-2"
        >
          {#if isLoading}
            <Spinner size="sm" />
            Creating...
          {:else}
            Create Project
            <ChevronRight class="w-4 h-4" />
          {/if}
        </Button>
      </form>
    </CardContent>
  </Card>
</div>
