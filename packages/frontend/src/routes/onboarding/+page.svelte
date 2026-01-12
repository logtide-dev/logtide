<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { organizationStore, currentOrganization } from '$lib/stores/organization';
  import { OrganizationsAPI } from '$lib/api/organizations';
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
  let hasOrganizations = $state(false);
  let checkingOrgs = $state(true);
  let token = $state<string | null>(null);

  let organizationsAPI = $derived(new OrganizationsAPI(() => token));

  authStore.subscribe((state) => {
    isAuthenticated = !!state.user;
    token = state.token;
    userName = state.user?.name || state.user?.email?.split('@')[0] || 'there';
  });

  onboardingStore.subscribe((state) => {
    currentStep = state.currentStep;
  });

  // Only redirect to dashboard if onboarding is complete AND user has organizations
  $effect(() => {
    if (!checkingOrgs && $isOnboardingComplete && hasOrganizations) {
      goto('/dashboard');
    }
  });

  onMount(async () => {
    // Redirect to login if not authenticated
    if (!$authStore.user) {
      goto('/login');
      return;
    }

    // Check if user has organizations
    try {
      const response = await organizationsAPI.getOrganizations();
      hasOrganizations = response.organizations.length > 0;

      // If onboarding was "complete" but user has no orgs, reset onboarding
      if ($isOnboardingComplete && !hasOrganizations) {
        onboardingStore.reset();
      }

      // If user already has orgs, they can skip to dashboard
      if (hasOrganizations && $currentOrganization) {
        goto('/dashboard');
        return;
      }
    } catch (e) {
      console.error('Failed to check organizations:', e);
    } finally {
      checkingOrgs = false;
    }
  });
</script>

<svelte:head>
  <title>Getting Started - LogTide</title>
</svelte:head>

{#if isAuthenticated && !checkingOrgs}
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
{:else if isAuthenticated && checkingOrgs}
  <div class="min-h-screen flex items-center justify-center">
    <div class="text-center space-y-2">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
      <p class="text-sm text-muted-foreground">Loading...</p>
    </div>
  </div>
{/if}
