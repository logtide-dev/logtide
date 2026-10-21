<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
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
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Check from '@lucide/svelte/icons/check';
  import { isSafeInternalPath, safeRedirect } from '$lib/utils/redirect';

  // Get redirect URL from query params (e.g., for invitation flow)
  let redirectUrl = $derived(page.url.searchParams.get('redirect'));

  // Registration mode: 'select' (provider selection), 'ldap' (LDAP form)
  type RegisterMode = 'select' | 'ldap';
  let mode = $state<RegisterMode>('select');
  let selectedLdapProvider = $state<AuthProvider | null>(null);

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let showPassword = $state(false);
  let hasExternalProvider = $state(false);
  let error = $state('');
  let loading = $state(false);
  let nameError = $state('');
  let emailError = $state('');
  let passwordError = $state('');
  const passwordMet = $derived(password.length >= 8);
  let token = $state<string | null>(null);
  let hasLocalProvider = $state(true);
  let organizationsAPI = $derived(new OrganizationsAPI(() => token));
  let checkingAuthConfig = $state(true);
  let signupDisabled = $state(false);
  // Terms seam: set only when the backend advertises termsUrl/privacyUrl.
  let termsUrl = $state<string | null>(null);
  let privacyUrl = $state<string | null>(null);
  let acceptTerms = $state(false);
  let termsRequired = $derived(termsUrl !== null && privacyUrl !== null);

  // Check auth config on mount
  onMount(async () => {
    try {
      const config = await authAPI.getAuthConfig();
      if (config.authMode === 'none') {
        // Auth-free mode: redirect to dashboard directly (validate the
        // user-supplied redirect to prevent open redirect)
        goto(safeRedirect(redirectUrl));
        return;
      }
      if (!config.signupEnabled) {
        signupDisabled = true;
      }
      if (config.termsUrl && config.privacyUrl) {
        termsUrl = config.termsUrl;
        privacyUrl = config.privacyUrl;
      }
    } catch (e) {
      console.error('Failed to get auth config:', e);
    }
    try {
      const { providers } = await authAPI.getProviders();
      hasExternalProvider = providers.some((p) => p.type !== 'local');
    } catch {
      // The provider selector reports its own load failure.
    }
    checkingAuthConfig = false;
  });

  const unsubAuthStore = authStore.subscribe((state) => {
    token = state.token;
  });

  onDestroy(() => {
    unsubAuthStore();
  });

  function validateForm(): boolean {
    nameError = '';
    emailError = '';
    passwordError = '';
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
      const response = await authAPI.register({
        name,
        email,
        password,
        ...(termsRequired ? { acceptTerms } : {}),
      });
      if (!response.session) {
        // 201 without a session: the account exists but auto-login failed
        // transiently, so send the user to the login page instead of crashing.
        toastStore.success('Your account has been created. Please sign in.');
        goto(`/login${redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : ''}`);
        return;
      }
      await handleAuthSuccess({ ...response, session: response.session }, true);
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
      toastStore.success('Welcome to LogTide! Your account has been created.');
    } else {
      toastStore.success('Welcome back!');
    }

    // If there's a redirect URL (e.g., invitation), go there; otherwise go to onboarding
    // Validate to prevent open redirect (see isSafeInternalPath)
    if (isSafeInternalPath(redirectUrl)) {
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
  <title>Sign up - LogTide</title>
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
            <img src={$smallLogoPath} alt="LogTide Logo" class="h-16 w-auto" />
            <div>
                <CardTitle class="text-2xl">Registration disabled</CardTitle>
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
            <img src={$smallLogoPath} alt="LogTide Logo" class="h-16 w-auto" />
            <div>
                <CardTitle class="text-2xl">Create an account</CardTitle>
                <CardDescription>Get started with LogTide</CardDescription>
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
                <div class="relative">
                  <Input
                    id="password"
                    type={(showPassword ? 'text' : 'password') as 'text'}
                    autocomplete="new-password"
                    bind:value={password}
                    disabled={loading}
                    required
                    class="pr-10 {passwordError ? 'border-destructive' : ''}"
                  />
                  <button
                    type="button"
                    class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    onclick={() => (showPassword = !showPassword)}
                  >
                    {#if showPassword}
                      <EyeOff class="size-4" aria-hidden="true" />
                    {:else}
                      <Eye class="size-4" aria-hidden="true" />
                    {/if}
                  </button>
                </div>
                <p
                  class="flex items-center gap-1 text-xs {passwordMet ? 'text-success-text' : 'text-muted-foreground'}"
                  data-testid="password-rule"
                  data-met={passwordMet}
                >
                  {#if passwordMet}<Check class="size-3" aria-hidden="true" />{/if}
                  At least 8 characters
                </p>
                {#if passwordError}
                  <p class="text-sm text-destructive-text">{passwordError}</p>
                {/if}
              </div>

              {#if termsRequired}
                <div class="flex items-start gap-2">
                  <input
                    id="acceptTerms"
                    type="checkbox"
                    bind:checked={acceptTerms}
                    disabled={loading}
                    required
                    class="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                  />
                  <label for="acceptTerms" class="text-sm text-muted-foreground">
                    I agree to the
                    <a href={termsUrl} target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">Terms of Service</a>
                    and the
                    <a href={privacyUrl} target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">Privacy Policy</a>
                  </label>
                </div>
              {/if}

              <Button type="submit" class="w-full gap-2" disabled={loading || (termsRequired && !acceptTerms)}>
                {#if loading}
                  <Spinner size="sm" />
                  Creating account...
                {:else}
                  {hasExternalProvider ? 'Create account with email' : 'Create account'}
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
