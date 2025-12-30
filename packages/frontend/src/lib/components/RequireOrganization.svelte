<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { currentOrganization, organizationStore } from '$lib/stores/organization';
  import { OrganizationsAPI } from '$lib/api/organizations';
  import { authAPI } from '$lib/api/auth';
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import Building2 from '@lucide/svelte/icons/building-2';
  import AlertCircle from '@lucide/svelte/icons/alert-circle';

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

  let loading = $state(true);
  let checkingOrg = $state(true);

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
        if (!$authStore.user) {
          goto('/login');
          return;
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
      try {
        const orgs = await organizationStore.fetchOrganizations(async () => {
          const response = await organizationsAPI.getOrganizations();
          return response.organizations;
        });

        if (orgs.length === 0) {
          goto('/onboarding');
          return;
        }

        checkingOrg = false;
        loading = false;
      } catch (error) {
        console.error('Failed to fetch organizations:', error);
        checkingOrg = false;
        loading = false;
      }
    } else {
      checkingOrg = false;
      loading = false;
    }
  });

  function createOrganization() {
    goto('/onboarding');
  }
</script>

{#if loading || checkingOrg}
  <div class="flex items-center justify-center min-h-[60vh]">
    <div class="text-center space-y-4">
      <Spinner size="lg" />
      <p class="text-sm text-muted-foreground">Loading organization...</p>
    </div>
  </div>
{:else if !$currentOrganization}
  <div class="flex items-center justify-center min-h-[60vh] p-4">
    <Card class="max-w-md">
      <CardHeader>
        <div class="flex items-center gap-3 mb-2">
          <div class="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <AlertCircle class="w-6 h-6 text-muted-foreground" />
          </div>
          <div>
            <CardTitle>No Organization Selected</CardTitle>
            <CardDescription>Please select or create an organization to continue</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Button onclick={createOrganization} class="w-full gap-2">
          <Building2 class="w-4 h-4" />
          Create Organization
        </Button>
      </CardContent>
    </Card>
  </div>
{:else}
  {@render children?.()}
{/if}
