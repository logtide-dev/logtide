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

  // Get redirect URL from query params (e.g., for invitation flow)
  let redirectUrl = $derived($page.url.searchParams.get('redirect'));

  // Registration mode: 'select' (provider selection), 'ldap' (LDAP form)
  type RegisterMode = 'select' | 'ldap';
  let mode = $state<RegisterMode>('select');
  let selectedLdapProvider = $state<AuthProvider | null>(null);

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let confirmPassword = $state('');
  let error = $state('');
  let loading = $state(false);
  let nameError = $state('');
  let emailError = $state('');
  let passwordError = $state('');
  let confirmPasswordError = $state('');
  let token = $state<string | null>(null);
  let hasLocalProvider = $state(true);
  let organizationsAPI = $derived(new OrganizationsAPI(() => token));
  let checkingAuthConfig = $state(true);
  let signupDisabled = $state(false);

  // Check auth config on mount
  onMount(async () => {
    try {
      const config = await authAPI.getAuthConfig();
      if (config.authMode === 'none') {
        // Auth-free mode: redirect to dashboard directly
        goto(redirectUrl || '/dashboard');
        return;
      }
      if (!config.signupEnabled) {
        signupDisabled = true;
      }
    } catch (e) {
      console.error('Failed to get auth config:', e);
    }
    checkingAuthConfig = false;
  });

  authStore.subscribe((state) => {
    token = state.token;
  });

  function validateForm(): boolean {
    nameError = '';
    emailError = '';
    passwordError = '';
    confirmPasswordError = '';
    let isValid = true;

    if (!name.trim()) {
      nameError = 'Name is required';
      isValid = false;
    }

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
    } else if (password.length < 8) {
      passwordError = 'Password must be at least 8 characters';
      isValid = false;
    }

    if (!confirmPassword) {
      confirmPasswordError = 'Please confirm your password';
      isValid = false;
    } else if (password !== confirmPassword) {
      confirmPasswordError = 'Passwords do not match';
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
      const response = await authAPI.register({ name, email, password });
      await handleAuthSuccess(response, true);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Registration failed';
      error = errorMsg;
      toastStore.error(errorMsg);
    } finally {
      loading = false;
    }
  }

  async function handleAuthSuccess(response: AuthResponse & { isNewUser?: boolean }, isLocalRegistration = false) {
    authStore.setAuth(response.user, response.session.token);

    // Fetch user's organizations
    const orgs = await organizationStore.fetchOrganizations(async () => {
      const orgResponse = await organizationsAPI.getOrganizations();
      return orgResponse.organizations;
    });

    if (isLocalRegistration || response.isNewUser) {
      toastStore.success('Welcome to LogWard! Your account has been created.');
    } else {
      toastStore.success('Welcome back!');
    }

    // If there's a redirect URL (e.g., invitation), go there; otherwise go to onboarding
    if (redirectUrl) {
      goto(redirectUrl);
    } else if (orgs.length === 0) {
      // New users don't have organizations yet -> redirect to onboarding tutorial
      goto('/onboarding');
    } else {
      goto('/dashboard');
    }
  }

  async function handleSelectOidc(provider: AuthProvider) {
    loading = true;
    error = '';

    try {
      const { url } = await authAPI.getOidcAuthorizationUrl(provider.slug);
      // Redirect to OIDC provider
      window.location.href = url;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to start SSO registration';
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
    handleAuthSuccess(response);
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
  <title>Sign Up - LogWard</title>
</svelte:head>

<div class="min-h-screen flex flex-col bg-background">
  <div class="flex-1 flex items-center justify-center p-4">
    {#if checkingAuthConfig}
      <Card class="w-full max-w-md">
        <CardContent class="flex flex-col items-center justify-center py-12">
          <Spinner size="lg" />
          <p class="text-muted-foreground mt-4">Loading...</p>
        </CardContent>
      </Card>
    {:else if signupDisabled}
      <Card class="w-full max-w-md">
        <CardHeader class="flex flex-row justify-center items-center gap-4">
            <img src={$smallLogoPath} alt="LogWard Logo" class="h-16 w-auto" />
            <div>
                <CardTitle class="text-2xl">Registration Disabled</CardTitle>
                <CardDescription>New accounts cannot be created</CardDescription>
            </div>
        </CardHeader>
        <CardContent class="space-y-4">
          <Alert variant="destructive">
            <AlertDescription>
              User registration is currently disabled. Please contact an administrator if you need access.
            </AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter class="flex flex-col gap-4">
          <p class="text-sm text-muted-foreground text-center">
            Already have an account?
            <a href="/login{redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : ''}" class="text-primary hover:underline">Sign in</a>
          </p>
        </CardFooter>
      </Card>
    {:else}
    <Card class="w-full max-w-md">
        <CardHeader class="flex flex-row justify-center items-center gap-4">
            <img src={$smallLogoPath} alt="LogWard Logo" class="h-16 w-auto" />
            <div>
                <CardTitle class="text-2xl">Create an account</CardTitle>
                <CardDescription>Get started with LogWard</CardDescription>
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
            onSelectOidc={handleSelectOidc}
            onSelectLdap={handleSelectLdap}
            onProvidersLoaded={handleProvidersLoaded}
            actionLabel="Sign up"
          />

          <!-- Local registration form shown after provider selector when local is available -->
          {#if hasLocalProvider}
          <form onsubmit={(e: SubmitEvent) => { e.preventDefault(); handleSubmit(); }}>
            <div class="space-y-4">
              <div class="space-y-2">
                <Label for="name">Name</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="John Doe"
                  bind:value={name}
                  disabled={loading}
                  required
                  class={nameError ? 'border-destructive' : ''}
                />
                {#if nameError}
                  <p class="text-sm text-destructive">{nameError}</p>
                {/if}
              </div>

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

              <div class="space-y-2">
                <Label for="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  bind:value={confirmPassword}
                  disabled={loading}
                  required
                  class={confirmPasswordError ? 'border-destructive' : ''}
                />
                {#if confirmPasswordError}
                  <p class="text-sm text-destructive">{confirmPasswordError}</p>
                {/if}
              </div>

              <Button type="submit" class="w-full gap-2" disabled={loading}>
                {#if loading}
                  <Spinner size="sm" />
                  Creating account...
                {:else}
                  Create account with Email
                {/if}
              </Button>
            </div>
          </form>
          {/if}

        {:else if mode === 'ldap' && selectedLdapProvider}
          <!-- LDAP Registration Form -->
          <LdapLoginForm
            provider={selectedLdapProvider}
            onSuccess={handleLdapSuccess}
            onBack={handleBack}
          />
        {/if}
      </CardContent>

      <CardFooter class="flex flex-col gap-4">
        <p class="text-sm text-muted-foreground text-center">
          Already have an account?
          <a href="/login{redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : ''}" class="text-primary hover:underline">Sign in</a>
        </p>
      </CardFooter>
    </Card>
    {/if}
  </div>

  <Footer />
</div>
