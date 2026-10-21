<script lang="ts">
  import { goto } from '$app/navigation';
  import { checklistStore, checklistProgress, isChecklistComplete, type ChecklistItem, type ChecklistState } from '$lib/stores/checklist';
  import { currentOrganization } from '$lib/stores/organization';
  import { authStore } from '$lib/stores/auth';
  import { ProjectsAPI } from '$lib/api/projects';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Progress } from '$lib/components/ui/progress';
  import { slide } from 'svelte/transition';
  import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
  import Circle from '@lucide/svelte/icons/circle';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import X from '@lucide/svelte/icons/x';
  import Rocket from '@lucide/svelte/icons/rocket';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import type { OrganizationWithRole } from '@logtide/shared';

  // Use $ prefix for store subscriptions in Svelte 5
  const checklistState = $derived($checklistStore);
  const progressValue = $derived($checklistProgress);
  const complete = $derived($isChecklistComplete);
  const org = $derived($currentOrganization);
  const authState = $derived($authStore);

  function toggleCollapsed() {
    checklistStore.toggleCollapsed();
  }

  function dismiss() {
    checklistStore.dismiss();
  }

  async function navigateToItem(item: ChecklistItem) {
    // Special handling for create-api-key: navigate to first project's settings
    if (item.id === 'create-api-key' && org && authState.token) {
      try {
        const api = new ProjectsAPI(() => authState.token);
        const { projects } = await api.getProjects(org.id);
        if (projects.length > 0) {
          goto(`/dashboard/projects/${projects[0].id}/settings`);
          return;
        }
      } catch (e) {
        console.error('Failed to get projects:', e);
      }
    }

    // Default navigation
    if (item.link) {
      goto(item.link);
    }
  }
</script>

{#if !checklistState.dismissed && !complete}
  <Card class="border-primary/20 bg-primary/5">
    <CardHeader class="pb-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Rocket class="w-4 h-4 text-primary" />
          <CardTitle class="text-sm font-medium">Getting started</CardTitle>
        </div>
        <div class="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            class="h-6 w-6"
            onclick={toggleCollapsed}
            aria-label={checklistState.collapsed ? 'Expand checklist' : 'Collapse checklist'}
          >
            {#if checklistState.collapsed}
              <ChevronDown class="w-4 h-4" />
            {:else}
              <ChevronUp class="w-4 h-4" />
            {/if}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            class="h-6 w-6 text-muted-foreground hover:text-foreground"
            onclick={dismiss}
            aria-label="Dismiss checklist"
          >
            <X class="w-4 h-4" />
          </Button>
        </div>
      </div>
      <div class="flex items-center gap-2 mt-2">
        <Progress value={progressValue} class="h-1.5 flex-1" />
        <span class="text-xs text-muted-foreground font-medium">{progressValue}%</span>
      </div>
    </CardHeader>

    {#if !checklistState.collapsed}
      <div transition:slide={{ duration: 200 }}>
        <CardContent class="pt-2">
          <ul class="space-y-1">
          {#each checklistState.items as item}
            <li>
              <button
                onclick={() => navigateToItem(item)}
                class="w-full flex items-start gap-2 p-2 rounded-md text-left transition-colors hover:bg-primary/10 group"
              >
                {#if item.completed}
                  <CheckCircle2 class="w-4 h-4 text-success-text mt-0.5 flex-shrink-0" />
                {:else}
                  <Circle class="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                {/if}
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium {item.completed ? 'text-muted-foreground line-through' : ''}">
                    {item.label}
                  </p>
                  <p class="text-xs text-muted-foreground truncate">
                    {item.description}
                  </p>
                </div>
                {#if item.link && !item.completed}
                  <ExternalLink class="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
                {/if}
              </button>
            </li>
          {/each}
          </ul>
        </CardContent>
      </div>
    {/if}
  </Card>
{:else if complete && !checklistState.dismissed}
  <Card class="border-success/20 bg-success/5">
    <CardContent class="py-4">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center">
          <CheckCircle2 class="w-5 h-5 text-success-text" />
        </div>
        <div class="flex-1">
          <p class="text-sm font-medium text-success-text">Setup complete</p>
          <p class="text-xs text-muted-foreground">You've completed all getting started tasks</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          class="h-6 w-6 text-muted-foreground hover:text-foreground"
          onclick={dismiss}
          aria-label="Dismiss checklist"
        >
          <X class="w-4 h-4" />
        </Button>
      </div>
    </CardContent>
  </Card>
{/if}
