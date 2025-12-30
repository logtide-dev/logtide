<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { authStore } from '$lib/stores/auth';
  import { organizationStore } from '$lib/stores/organization';
  import { toastStore } from '$lib/stores/toast';
  import { authAPI } from '$lib/api/auth';
  import { OrganizationsAPI } from '$lib/api/organizations';
  import Spinner from '$lib/components/Spinner.svelte';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import Button from '$lib/components/ui/button/button.svelte';
  import { smallLogoPath } from '$lib/utils/theme';

  let loading = $state(true);
  let error = $state<string | null>(null);
  let status = $state('Processing authentication...');

  onMount(async () => {
    try {
      // Get token from URL params (set by backend callback redirect)
      const token = $page.url.searchParams.get('token');
      const expires = $page.url.searchParams.get('expires');
      const isNewUser = $page.url.searchParams.get('new_user') === 'true';

      if (!token) {
        error = 'No authentication token received. Please try logging in again.';
        loading = false;
        return;
      }

      status = 'Validating session...';

      // Validate the token and get user info
      const { user } = await authAPI.getMe(token);

      // Store auth state
      authStore.setAuth(user, token);

      status = 'Loading organizations...';

      // Fetch user's organizations
      const organizationsAPI = new OrganizationsAPI(() => token);
      const orgs = await organizationStore.fetchOrganizations(async () => {
        const response = await organizationsAPI.getOrganizations();
        return response.organizations;
      });

      if (isNewUser) {
        toastStore.success('Welcome to LogWard! Your account has been created.');
      } else {
        toastStore.success('Welcome back!');
      }

      // Redirect based on organization status
      if (orgs.length === 0) {
        goto('/onboarding');
      } else {
        goto('/dashboard');
      }
    } catch (e) {
      console.error('Auth callback error:', e);
      error = e instanceof Error ? e.message : 'Authentication failed. Please try again.';
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>Authenticating - LogWard</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-background p-4">
  <Card class="w-full max-w-md">
    <CardHeader class="flex flex-row justify-center items-center gap-4">
      <img src={$smallLogoPath} alt="LogWard Logo" class="h-16 w-auto" />
      <div>
        <CardTitle class="text-2xl">
          {#if loading}
            Signing in...
          {:else if error}
            Authentication Failed
          {:else}
            Welcome!
          {/if}
        </CardTitle>
        <CardDescription>
          {#if loading}
            {status}
          {:else if error}
            There was a problem signing you in
          {/if}
        </CardDescription>
      </div>
    </CardHeader>

    <CardContent class="flex flex-col items-center gap-4">
      {#if loading}
        <Spinner size="lg" />
        <p class="text-sm text-muted-foreground">{status}</p>
      {:else if error}
        <Alert variant="destructive" class="w-full">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button href="/login" class="w-full">
          Back to Login
        </Button>
      {/if}
    </CardContent>
  </Card>
</div>
