<script lang="ts">
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { organizationStore } from '$lib/stores/organization';
  import { toastStore } from '$lib/stores/toast';
  import { authAPI } from '$lib/api/auth';
  import { OrganizationsAPI } from '$lib/api/organizations';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import Spinner from '$lib/components/Spinner.svelte';
  import Footer from '$lib/components/Footer.svelte';

  let email = '';
  let password = '';
  let error = '';
  let loading = false;
  let emailError = '';
  let passwordError = '';
  let token = $state<string | null>(null);
  let organizationsAPI = $derived(new OrganizationsAPI(() => token));

  authStore.subscribe((state) => {
    token = state.token;
  });

  function validateForm(): boolean {
    emailError = '';
    passwordError = '';
    let isValid = true;

    if (!email) {
      emailError = 'Email is required';
      isValid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailError = 'Please enter a valid email';
      isValid = false;
    }

    if (!password) {
      passwordError = 'Password is required';
      isValid = false;
    }

    return isValid;
  }

  async function handleSubmit() {
    if (!validateForm()) {
      error = 'Please fix the errors below';
      return;
    }

    loading = true;
    error = '';

    try {
      const response = await authAPI.login({ email, password });
      authStore.setAuth(response.user, response.session.token);

      // Fetch user's organizations
      const orgs = await organizationStore.fetchOrganizations(async () => {
        const response = await organizationsAPI.getOrganizations();
        return response.organizations;
      });

      toastStore.success('Welcome back!');

      if (orgs.length === 0) {
        // No organizations -> redirect to onboarding tutorial
        goto('/onboarding');
      } else {
        // Has organizations (auto-selected by fetchOrganizations) -> redirect to dashboard
        goto('/dashboard');
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Login failed';
      error = errorMsg;
      toastStore.error(errorMsg);
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Login - LogWard</title>
</svelte:head>

<div class="min-h-screen flex flex-col bg-background">
  <div class="flex-1 flex items-center justify-center p-4">
    <Card class="w-full max-w-md">
      <CardHeader class="flex flex-row justify-center items-center gap-4">
          <img src="/small_logo/white.svg" alt="LogWard Logo" class="h-16 w-auto" />
          <div>
              <CardTitle class="text-2xl">Welcome back</CardTitle>
              <CardDescription>Sign in to your LogWard account</CardDescription>
          </div>
      </CardHeader>

      <form on:submit|preventDefault={handleSubmit}>
        <CardContent class="space-y-4">
          {#if error}
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          {/if}

          <div class="space-y-2">
            <Label for="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              bind:value={email}
              disabled={loading}
              required
              class={emailError ? 'border-destructive' : ''}
            />
            {#if emailError}
              <p class="text-sm text-destructive">{emailError}</p>
            {/if}
          </div>

          <div class="space-y-2">
            <Label for="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              bind:value={password}
              disabled={loading}
              required
              class={passwordError ? 'border-destructive' : ''}
            />
            {#if passwordError}
              <p class="text-sm text-destructive">{passwordError}</p>
            {/if}
          </div>
        </CardContent>

        <CardFooter class="flex flex-col gap-4">
          <Button type="submit" class="w-full gap-2" disabled={loading}>
            {#if loading}
              <Spinner size="sm" />
              Signing in...
            {:else}
              Sign in
            {/if}
          </Button>

          <p class="text-sm text-muted-foreground text-center">
            Don't have an account?
            <a href="/register" class="text-primary hover:underline">Sign up</a>
          </p>
        </CardFooter>
      </form>
    </Card>
  </div>

  <Footer />
</div>
