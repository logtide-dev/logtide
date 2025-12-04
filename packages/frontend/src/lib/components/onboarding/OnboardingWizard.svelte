<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { onboardingStore, type OnboardingStep } from '$lib/stores/onboarding';
  import { organizationStore } from '$lib/stores/organization';
  import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import { fade, fly, scale } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import Check from '@lucide/svelte/icons/check';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import X from '@lucide/svelte/icons/x';
  import type { Snippet } from 'svelte';

  interface Props {
    /** Whether to show the progress bar */
    showProgress?: boolean;
    /** Whether to show the skip button */
    showSkip?: boolean;
    /** Custom class for the container */
    class?: string;
    /** Children content */
    children?: Snippet;
  }

  let {
    showProgress = true,
    showSkip = true,
    class: className = '',
    children
  }: Props = $props();

  let state = $state<{
    currentStep: OnboardingStep;
    completedSteps: OnboardingStep[];
    skipped: boolean;
  }>({
    currentStep: 'welcome',
    completedSteps: [],
    skipped: false
  });

  onboardingStore.subscribe((s) => {
    state = {
      currentStep: s.currentStep,
      completedSteps: s.completedSteps,
      skipped: s.skipped
    };
  });

  const stepLabels: Record<OnboardingStep, string> = {
    'welcome': 'Welcome',
    'create-organization': 'Organization',
    'create-project': 'Project',
    'api-key': 'API Key',
    'first-log': 'First Log',
    'feature-tour': 'Tour',
    'completed': 'Done'
  };

  const visibleSteps = onboardingStore.stepOrder;

  let currentStepIndex = $derived(visibleSteps.indexOf(state.currentStep));
  let progressPercent = $derived(((currentStepIndex + 1) / visibleSteps.length) * 100);

  function isStepCompleted(step: OnboardingStep) {
    return state.completedSteps.includes(step);
  }

  function isStepCurrent(step: OnboardingStep) {
    return state.currentStep === step;
  }

  async function handleSkip() {
    // Check if user already has an organization
    const hasOrg = $organizationStore.organizations.length > 0 || $organizationStore.currentOrganization !== null;

    if (hasOrg) {
      // User has an org, can skip directly to dashboard
      await onboardingStore.skip();
      goto('/dashboard');
    } else {
      // Skip the tutorial intro but still require organization creation
      // (user needs an org to access dashboard)
      onboardingStore.setSkipAfterOrgCreation(true);
      onboardingStore.goToStep('create-organization');
    }
  }
</script>

<div class="min-h-screen bg-background flex flex-col {className}">
  <!-- Header with progress -->
  {#if showProgress && state.currentStep !== 'completed'}
    <header class="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div class="max-w-4xl mx-auto px-4 py-3">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-3">
            <img src="/small_logo/white.svg" alt="LogWard" class="h-8 w-auto" />
            <span class="text-sm text-muted-foreground">Getting Started</span>
          </div>
          {#if showSkip}
            <Button variant="ghost" size="sm" onclick={handleSkip} class="text-muted-foreground">
              Skip tutorial
              <X class="w-4 h-4 ml-1" />
            </Button>
          {/if}
        </div>

        <!-- Progress bar -->
        <div class="relative">
          <div class="h-1 bg-muted rounded-full overflow-hidden">
            <div
              class="h-full bg-primary transition-all duration-500 ease-out"
              style="width: {progressPercent}%"
            ></div>
          </div>

          <!-- Step indicators -->
          <div class="flex justify-between mt-2">
            {#each visibleSteps as step, index}
              <div class="flex flex-col items-center">
                <div
                  class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-300
                    {isStepCompleted(step)
                      ? 'bg-primary text-primary-foreground'
                      : isStepCurrent(step)
                        ? 'bg-primary/20 text-primary border-2 border-primary'
                        : 'bg-muted text-muted-foreground'}"
                >
                  {#if isStepCompleted(step)}
                    <Check class="w-3 h-3" />
                  {:else}
                    {index + 1}
                  {/if}
                </div>
                <span
                  class="text-xs mt-1 hidden sm:block transition-colors
                    {isStepCurrent(step) ? 'text-primary font-medium' : 'text-muted-foreground'}"
                >
                  {stepLabels[step]}
                </span>
              </div>
            {/each}
          </div>
        </div>
      </div>
    </header>
  {/if}

  <!-- Main content area -->
  <main class="flex-1 flex items-center justify-center p-4">
    <div
      class="w-full max-w-2xl"
      in:fly={{ y: 20, duration: 400, easing: quintOut }}
    >
      {#if children}
        {@render children()}
      {/if}
    </div>
  </main>
</div>
