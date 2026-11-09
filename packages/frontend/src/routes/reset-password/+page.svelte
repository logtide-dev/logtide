<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { authAPI } from '$lib/api/auth';
  import { authStore } from '$lib/stores/auth';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import Spinner from '$lib/components/Spinner.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import PasswordStrengthField from '$lib/components/auth/PasswordStrengthField.svelte';
  import { isStrongPassword } from '$lib/utils/password-check';
  import { smallLogoPath } from '$lib/utils/theme';

  let token = $state<string | null>(null);
  let view = $state<'form' | 'success' | 'invalid'>('form');
  let password = $state('');
  let passwordOk = $state(false);
  let submitting = $state(false);
  let errorMessage = $state('');

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
    if (!passwordOk) {
      passwordOk = await isStrongPassword(password);
    }
    if (!passwordOk) {
      errorMessage = 'Choose a stronger password';
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
        // The API passes the server's reason for a weak password through.
        errorMessage = message || 'Could not reset the password. Try again.';
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
          <PasswordStrengthField
            id="password"
            label="New password"
            bind:value={password}
            bind:ok={passwordOk}
            disabled={submitting}
          />
          <Button type="submit" class="w-full gap-2" disabled={submitting || !passwordOk}>
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
