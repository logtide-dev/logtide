<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { authAPI } from '$lib/api/auth';
  import { authStore } from '$lib/stores/auth';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import Spinner from '$lib/components/Spinner.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import { smallLogoPath } from '$lib/utils/theme';

  const MIN_LENGTH = 8;

  let token = $state<string | null>(null);
  let view = $state<'form' | 'success' | 'invalid'>('form');
  let password = $state('');
  let showPassword = $state(false);
  let submitting = $state(false);
  let errorMessage = $state('');

  const tooShort = $derived(password.length < MIN_LENGTH);

  onMount(() => {
    token = page.url.searchParams.get('token');
    if (!token) {
      view = 'invalid';
    }
  });

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (submitting || !token) return;
    errorMessage = '';
    if (tooShort) {
      errorMessage = 'Password must be at least 8 characters';
      return;
    }

    submitting = true;
    try {
      await authAPI.confirmPasswordReset(token, password);
      // The server revoked every session of this account.
      authStore.clearAuth();
      password = '';
      view = 'success';
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      if (message === 'invalid_or_expired_token') {
        view = 'invalid';
      } else if (message === 'rate_limited') {
        errorMessage = 'Too many attempts, try again later';
      } else {
        errorMessage = 'Could not reset the password. Try again.';
      }
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Reset password - LogTide</title>
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-background px-4">
  {#if view === 'invalid'}
    <div class="w-full max-w-md">
      <EmptyState
        variant="error"
        title="This link is invalid or expired"
        description="Reset links work once and expire after 1 hour. Request a new one to continue."
      >
        {#snippet actions()}
          <Button href="/forgot-password">Request a new link</Button>
        {/snippet}
      </EmptyState>
    </div>
  {:else if view === 'success'}
    <Card class="w-full max-w-md">
      <CardHeader class="text-center">
        <div class="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <CircleCheck class="h-6 w-6 text-success-text" aria-hidden="true" />
        </div>
        <CardTitle>Password updated</CardTitle>
        <CardDescription>
          You were signed out everywhere. Sign in with your new password.
        </CardDescription>
      </CardHeader>
      <CardContent class="flex justify-center">
        <Button href="/login">Sign in</Button>
      </CardContent>
    </Card>
  {:else}
    <Card class="w-full max-w-md">
      <CardHeader class="flex flex-row items-center justify-center gap-4">
        <img src={$smallLogoPath} alt="LogTide logo" class="h-16 w-auto" />
        <div>
          <CardTitle class="text-2xl">Reset password</CardTitle>
          <CardDescription>Choose a new password for your account</CardDescription>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        {#if errorMessage}
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        {/if}
        <form onsubmit={handleSubmit} class="space-y-4" novalidate>
          <div class="space-y-2">
            <Label for="password">New password</Label>
            <div class="relative">
              <Input
                id="password"
                type={(showPassword ? 'text' : 'password') as 'text'}
                autocomplete="new-password"
                bind:value={password}
                disabled={submitting}
                class="pr-10"
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
            <p class="text-xs {tooShort ? 'text-muted-foreground' : 'text-success-text'}">
              At least 8 characters
            </p>
          </div>
          <Button type="submit" class="w-full gap-2" disabled={submitting || tooShort}>
            {#if submitting}
              <Spinner size="sm" />
              Saving...
            {:else}
              Set new password
            {/if}
          </Button>
        </form>
      </CardContent>
    </Card>
  {/if}
</div>
