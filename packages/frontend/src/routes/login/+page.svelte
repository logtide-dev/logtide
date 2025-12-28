<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { authStore } from '$lib/stores/auth';
  import { organizationStore } from '$lib/stores/organization';
  import { toastStore } from '$lib/stores/toast';
  import { authAPI, type AuthProvider, type AuthResponse } from '$lib/api/auth';
  import { OrganizationsAPI } from '$lib/api/organizations';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import Spinner from '$lib/components/Spinner.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import ProviderSelector from '$lib/components/auth/ProviderSelector.svelte';
  import LdapLoginForm from '$lib/components/auth/LdapLoginForm.svelte';
  import { smallLogoPath } from '$lib/utils/theme';

  // Get redirect URL and error from query params
  let redirectUrl = $derived($page.url.searchParams.get('redirect'));
  let urlError = $derived($page.url.searchParams.get('error'));

  // Login mode: 'select' (provider selection), 'local' (email/password), 'ldap' (LDAP form)
  type LoginMode = 'select' | 'local' | 'ldap';
  let mode = $state<LoginMode>('select');
  let selectedLdapProvider = $state<AuthProvider | null>(null);

  let email = $state('');
  let password = $state('');
  let error = $state(urlError || '');
  let loading = $state(false);
  let emailError = $state('');
  let passwordError = $state('');
  let token = $state<string | null>(null);
  let hasLocalProvider = $state(true); // Default to true for initial load
  let organizationsAPI = $derived(new OrganizationsAPI(() => token));
  let checkingAuthMode = $state(true);

  // Check auth mode on mount - redirect if auth-free mode
  onMount(async () => {
    try {
      const config = await authAPI.getAuthConfig();
      if (config.authMode === 'none') {
        // Auth-free mode: redirect to dashboard directly
        goto(redirectUrl || '/dashboard');
        return;
      }
    } catch (e) {
      console.error('Failed to get auth config:', e);
    }
    checkingAuthMode = false;
  });

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

  async function handleLocalSubmit() {
    if (!validateForm()) {
      error = 'Please fix the errors below';
      return;
    }

    loading = true;
    error = '';

    try {
      const response = await authAPI.login({ email, password });
      await handleLoginSuccess(response);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Login failed';
      error = errorMsg;
      toastStore.error(errorMsg);
    } finally {
      loading = false;
    }
  }

  async function handleLoginSuccess(response: AuthResponse & { isNewUser?: boolean }) {
    authStore.setAuth(response.user, response.session.token);

    // Fetch user's organizations
    const orgs = await organizationStore.fetchOrganizations(async () => {
      const orgResponse = await organizationsAPI.getOrganizations();
      return orgResponse.organizations;
    });

    if (response.isNewUser) {
      toastStore.success('Welcome to LogWard! Your account has been created.');
    } else {
      toastStore.success('Welcome back!');
    }

    // If there's a redirect URL (e.g., invitation), go there
    if (redirectUrl) {
      goto(redirectUrl);
    } else if (orgs.length === 0) {
      // No organizations -> redirect to onboarding tutorial
      goto('/onboarding');
    } else {
      // Has organizations (auto-selected by fetchOrganizations) -> redirect to dashboard
      goto('/dashboard');
    }
  }

  function handleSelectLocal() {
    mode = 'local';
    error = '';
  }

  async function handleSelectOidc(provider: AuthProvider) {
    loading = true;
    error = '';

    try {
      const { url } = await authAPI.getOidcAuthorizationUrl(provider.slug);
      // Redirect to OIDC provider
      window.location.href = url;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to start SSO login';
      error = errorMsg;
      toastStore.error(errorMsg);
      loading = false;
    }
  }

  function handleSelectLdap(provider: AuthProvider) {
    selectedLdapProvider = provider;
    mode = 'ldap';
    error = '';
  }

  function handleLdapSuccess(response: AuthResponse & { isNewUser: boolean }) {
    handleLoginSuccess(response);
  }

  function handleBack() {
    mode = 'select';
    selectedLdapProvider = null;
    error = '';
  }

  function handleProvidersLoaded(hasLocal: boolean) {
    hasLocalProvider = hasLocal;
  }
</script>

<svelte:head>
  <title>Login - LogWard</title>
</svelte:head>

<div class="min-h-screen flex flex-col bg-background">
  <div class="flex-1 flex items-center justify-center p-4">
    {#if checkingAuthMode}
      <Card class="w-full max-w-md">
        <CardContent class="flex flex-col items-center justify-center py-12">
          <Spinner size="lg" />
          <p class="text-muted-foreground mt-4">Checking authentication...</p>
        </CardContent>
      </Card>
    {:else}
    <Card class="w-full max-w-md">
      <CardHeader class="flex flex-row justify-center items-center gap-4">
        <img src={$smallLogoPath} alt="LogWard Logo" class="h-16 w-auto" />
        <div>
          <CardTitle class="text-2xl">Welcome back</CardTitle>
          <CardDescription>Sign in to your LogWard account</CardDescription>
        </div>
      </CardHeader>

      <CardContent class="space-y-4">
        {#if error}
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        {/if}

        {#if mode === 'select'}
          <!-- Provider Selection -->
          <ProviderSelector
            onSelectLocal={handleSelectLocal}
            onSelectOidc={handleSelectOidc}
            onSelectLdap={handleSelectLdap}
            onProvidersLoaded={handleProvidersLoaded}
          />

          <!-- Local login form shown after provider selector when local is available -->
          {#if hasLocalProvider}
          <form onsubmit={(e: SubmitEvent) => { e.preventDefault(); handleLocalSubmit(); }}>
            <div class="space-y-4">
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

              <Button type="submit" class="w-full gap-2" disabled={loading}>
                {#if loading}
                  <Spinner size="sm" />
                  Signing in...
                {:else}
                  Sign in with Email
                {/if}
              </Button>
            </div>
          </form>
          {/if}

        {:else if mode === 'ldap' && selectedLdapProvider}
          <!-- LDAP Login Form -->
          <LdapLoginForm
            provider={selectedLdapProvider}
            onSuccess={handleLdapSuccess}
            onBack={handleBack}
          />
        {/if}
      </CardContent>

      <CardFooter class="flex flex-col gap-4">
        <p class="text-sm text-muted-foreground text-center">
          Don't have an account?
          <a href="/register{redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : ''}" class="text-primary hover:underline">Sign up</a>
        </p>
      </CardFooter>
    </Card>
    {/if}
  </div>

  <Footer />
</div>
