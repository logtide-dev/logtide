<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { onboardingStore, type OnboardingStep, isOnboardingComplete } from '$lib/stores/onboarding';
  import {
    OnboardingWizard,
    WelcomeStep,
    OrganizationStep,
    ProjectStep,
    ApiKeyStep,
    FirstLogStep,
    FeatureTourStep
  } from '$lib/components/onboarding';
  import Footer from '$lib/components/Footer.svelte';

  let currentStep = $state<OnboardingStep>('welcome');
  let userName = $state('');
  let isAuthenticated = $state(false);

  authStore.subscribe((state) => {
    isAuthenticated = !!state.user;
    userName = state.user?.name || state.user?.email?.split('@')[0] || 'there';
  });

  onboardingStore.subscribe((state) => {
    currentStep = state.currentStep;
  });

  isOnboardingComplete.subscribe((complete) => {
    if (complete) {
      goto('/dashboard');
    }
  });

  onMount(() => {
    // Redirect to login if not authenticated
    if (!$authStore.user) {
      goto('/login');
      return;
    }

    // Start onboarding if not already started
    const state = $onboardingStore;
    if (!state.startedAt && state.currentStep === 'welcome') {
      // Don't auto-start, let user click "Start Tutorial"
    }
  });
</script>

<svelte:head>
  <title>Getting Started - LogWard</title>
</svelte:head>

{#if isAuthenticated}
  <OnboardingWizard>
    {#if currentStep === 'welcome'}
      <WelcomeStep {userName} />
    {:else if currentStep === 'create-organization'}
      <OrganizationStep />
    {:else if currentStep === 'create-project'}
      <ProjectStep />
    {:else if currentStep === 'api-key'}
      <ApiKeyStep />
    {:else if currentStep === 'first-log'}
      <FirstLogStep />
    {:else if currentStep === 'feature-tour'}
      <FeatureTourStep />
    {/if}
  </OnboardingWizard>
  <Footer />
{/if}
