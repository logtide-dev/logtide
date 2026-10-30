<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { organizationStore } from '$lib/stores/organization';
  import { onboardingStore, type ServerOnboarding } from '$lib/stores/onboarding';
  import type { OnboardingStep } from '$lib/api/onboarding';
  import { OrganizationsAPI } from '$lib/api/organizations';
  import { authAPI } from '$lib/api/auth';
  import {
    OnboardingWizard,
    VerifyEmailStep,
    WorkspaceStep,
    ConnectStep,
    DoneStep,
    decideEntry,
  } from '$lib/components/onboarding';
  import type { EntryInput } from '$lib/components/onboarding/entry';
  import Footer from '$lib/components/Footer.svelte';
  import TermsAcceptanceModal from '$lib/components/TermsAcceptanceModal.svelte';

  let ready = $state(false);
  let showVerify = $state(false);
  let entry: Omit<EntryInput, 'server'> | null = null;
  let serverState: ServerOnboarding | null = null;

  const step = $derived<OnboardingStep | null>($onboardingStore.step);

  function apply(input: EntryInput) {
    const decision = decideEntry(input);
    if (decision.kind === 'redirect') {
      goto(decision.to);
      return;
    }
    onboardingStore.hydrate({
      step: decision.step,
      organizationId: decision.organizationId,
      projectId: decision.projectId,
    });
    ready = true;
  }

  function handleVerified() {
    if (!entry || !serverState) return;
    entry = { ...entry, emailVerified: true };
    apply({ ...entry, server: serverState });
  }

  onMount(async () => {
    const auth = $authStore;
    if (!auth.user || !auth.token) {
      goto('/login');
      return;
    }

    const organizationsAPI = new OrganizationsAPI(() => auth.token);
    const [config, me, orgs, server] = await Promise.all([
      authAPI.getAuthConfig().catch(() => ({ emailVerificationRequired: false })),
      authAPI.getMe(auth.token).catch(() => null),
      organizationsAPI.getOrganizations().then(
        (r) => r.organizations,
        () => []
      ),
      onboardingStore.load(),
    ]);

    if (orgs.length > 0) {
      await organizationStore.fetchOrganizations(async () => orgs);
      if (server.organizationId && orgs.some((o) => o.id === server.organizationId)) {
        organizationStore.setCurrentOrganization(server.organizationId);
      }
    }

    const required = config.emailVerificationRequired === true;
    showVerify = required;
    serverState = server;
    entry = {
      emailVerificationRequired: required,
      emailVerified: me?.user?.emailVerified,
      organizationCount: orgs.length,
    };
    apply({ ...entry, server });
  });
</script>

<svelte:head>
  <title>Getting started - LogTide</title>
</svelte:head>

{#if ready && step}
  <TermsAcceptanceModal />
  <OnboardingWizard {step} {showVerify}>
    {#if step === 'verify-email'}
      <VerifyEmailStep onVerified={handleVerified} />
    {:else if step === 'workspace'}
      <WorkspaceStep />
    {:else if step === 'connect'}
      <ConnectStep />
    {:else if step === 'done'}
      <DoneStep />
    {/if}
  </OnboardingWizard>
  <Footer />
{:else}
  <div class="flex min-h-screen items-center justify-center">
    <div class="space-y-2 text-center">
      <div class="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
      <p class="text-sm text-muted-foreground">Loading...</p>
    </div>
  </div>
{/if}
