<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { authStore } from '$lib/stores/auth';
  import { currentOrganization, organizationStore } from '$lib/stores/organization';
  import { OrganizationsAPI } from '$lib/api/organizations';
  import { authAPI } from '$lib/api/auth';
  import Button from '$lib/components/ui/button/button.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import PageSkeleton from '$lib/components/shell/PageSkeleton.svelte';
  import Building2 from '@lucide/svelte/icons/building-2';

  let token = $state<string | null>(null);
  let organizationsAPI = $derived(new OrganizationsAPI(() => token));

  $effect(() => {
    if (!browser) return;

    const unsubscribe = authStore.subscribe((state) => {
      token = state.token;
    });

    return unsubscribe;
  });

  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  // The instance admin area works without an organization.
  const isAdminPath = $derived(page.url.pathname.startsWith('/dashboard/admin'));

  let loading = $state(true);
  let checkingOrg = $state(true);
  let loadError = $state<string | null>(null);

  onMount(async () => {
    // Check auth-free mode first
    try {
      const config = await authAPI.getAuthConfig();

      if (config.authMode === 'none') {
        // Auth-free mode: get user from backend without token
        const result = await authAPI.getCurrentUserAuthFree();

        if (result && result.user) {
          // Set user in authStore (use dummy token for auth-free mode)
          authStore.setAuth(result.user, 'auth-free');
          // Also update token immediately for organizationsAPI
          token = 'auth-free';
        } else {
          // Auth-free mode is enabled but no default user configured
          console.error('Auth-free mode enabled but no default user configured');
          loading = false;
          checkingOrg = false;
          return;
        }
      } else {
        // Standard mode: check for token
        if (!$authStore.token) {
          goto('/login');
          return;
        }

        // Validate token against backend (catches stale localStorage tokens)
        try {
          const { user } = await authAPI.getMe($authStore.token);
          authStore.updateUser(user);
        } catch (e) {
          // Only a rejected token ends the session. A network failure (including
          // a fetch aborted by a reload or navigation) must not log the user out.
          if ((e as { status?: number }).status === 401) {
            authStore.clearAuth();
            goto('/login');
            return;
          }
        }
      }
    } catch (e) {
      console.error('Failed to check auth config:', e);
      // Fall back to standard auth check
      if (!$authStore.user) {
        goto('/login');
        return;
      }
    }

    // Now check organizations
    if (!$currentOrganization) {
      await loadOrganizations();
    } else {
      checkingOrg = false;
      loading = false;

      // The cached org object only exists to avoid a name flash on reload;
      // fields like retentionDays go stale if changed elsewhere (e.g. Admin).
      // Revalidate in the background without blocking the page.
      organizationStore
        .fetchOrganizations(async () => {
          const response = await organizationsAPI.getOrganizations();
          return response.organizations;
        })
        .catch((error) => {
          console.error('Failed to refresh organizations:', error);
        });
    }
  });

  async function loadOrganizations() {
    loadError = null;
    try {
      const orgs = await organizationStore.fetchOrganizations(async () => {
        const response = await organizationsAPI.getOrganizations();
        return response.organizations;
      });

      if (orgs.length === 0 && !isAdminPath) {
        goto('/onboarding');
        return;
      }
    } catch (error) {
      console.error('Failed to fetch organizations:', error);
      loadError = error instanceof Error ? error.message : 'Could not load your organizations';
    }
    checkingOrg = false;
    loading = false;
  }

  async function retry() {
    loading = true;
    checkingOrg = true;
    await loadOrganizations();
  }

  function createOrganization() {
    goto('/onboarding');
  }
</script>

{#if loading || checkingOrg}
  <PageSkeleton />
{:else if loadError && !$currentOrganization && !isAdminPath}
  <div class="p-6 sm:p-8">
    <div class="mx-auto max-w-md">
      <EmptyState
        variant="error"
        title="Could not load your organizations"
        description="Check your connection and try again."
      >
        {#snippet actions()}
          <Button onclick={retry}>Retry</Button>
        {/snippet}
      </EmptyState>
    </div>
  </div>
{:else if !$currentOrganization && !isAdminPath}
  <div class="p-6 sm:p-8">
    <div class="mx-auto max-w-md">
      <EmptyState
        variant="setup"
        title="Create your first organization"
        description="An organization holds your projects, logs and team members."
      >
        {#snippet actions()}
          <Button onclick={createOrganization} class="gap-2">
            <Building2 class="w-4 h-4" />
            Create organization
          </Button>
        {/snippet}
      </EmptyState>
    </div>
  </div>
{:else}
  {@render children?.()}
{/if}
