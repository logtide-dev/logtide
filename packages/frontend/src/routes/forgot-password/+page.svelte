<script lang="ts">
  import { onMount } from 'svelte';
  import { authAPI } from '$lib/api/auth';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import Spinner from '$lib/components/Spinner.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import MailCheck from '@lucide/svelte/icons/mail-check';
  import { smallLogoPath } from '$lib/utils/theme';

  const CONFIRMATION =
    'If an account exists for that address, we sent a link to reset the password. The link works for 1 hour.';

  let available = $state<boolean | null>(null);
  let email = $state('');
  let emailError = $state('');
  let sending = $state(false);
  let sent = $state(false);
  let errorMessage = $state('');

  onMount(async () => {
    try {
      const config = await authAPI.getAuthConfig();
      available = config.passwordResetEnabled === true;
    } catch {
      available = false;
    }
  });

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (sending) return;

    emailError = '';
    errorMessage = '';
    const value = email.trim();
    if (!value) {
      emailError = 'Email is required';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      emailError = 'Enter a valid email';
      return;
    }

    sending = true;
    try {
      await authAPI.requestPasswordReset(value);
      sent = true;
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      if (message === 'rate_limited') {
        errorMessage = 'Too many attempts, try again later';
      } else if (message === 'password_reset_unavailable') {
        available = false;
      } else {
        // Never reveal state: any other failure looks like a normal send.
        sent = true;
      }
    } finally {
      sending = false;
    }
  }
</script>

<svelte:head>
  <title>Forgot password - LogTide</title>
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-background px-4">
  {#if available === null}
    <Card class="w-full max-w-md">
      <CardContent class="flex flex-col items-center justify-center py-12">
        <Spinner size="lg" />
      </CardContent>
    </Card>
  {:else if available === false}
    <div class="w-full max-w-md">
      <EmptyState
        variant="error"
        title="Password reset is not available"
        description="This install cannot send reset emails. Ask an administrator to reset your password."
      >
        {#snippet actions()}
          <Button variant="outline" href="/login">Back to sign in</Button>
        {/snippet}
      </EmptyState>
    </div>
  {:else}
    <Card class="w-full max-w-md">
      <CardHeader class="flex flex-row items-center justify-center gap-4">
        <img src={$smallLogoPath} alt="LogTide logo" class="h-16 w-auto" />
        <div>
          <CardTitle class="text-2xl">Forgot password</CardTitle>
          <CardDescription>We will email you a link to choose a new one</CardDescription>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        {#if sent}
          <div class="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-4" role="status">
            <MailCheck class="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p class="text-sm">{CONFIRMATION}</p>
          </div>
          <Button variant="outline" class="w-full" href="/login">Back to sign in</Button>
        {:else}
          {#if errorMessage}
            <Alert variant="destructive">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          {/if}
          <form onsubmit={handleSubmit} class="space-y-4" novalidate>
            <div class="space-y-2">
              <Label for="email">Email</Label>
              <Input
                id="email"
                type="email"
                autocomplete="email"
                placeholder="you@example.com"
                bind:value={email}
                disabled={sending}
                class={emailError ? 'border-destructive' : ''}
              />
              {#if emailError}
                <p class="text-sm text-destructive-text">{emailError}</p>
              {/if}
            </div>
            <Button type="submit" class="w-full gap-2" disabled={sending}>
              {#if sending}
                <Spinner size="sm" />
                Sending...
              {:else}
                Send reset link
              {/if}
            </Button>
          </form>
          <p class="text-center text-sm text-muted-foreground">
            <a href="/login" class="text-primary-text hover:underline">Back to sign in</a>
          </p>
        {/if}
      </CardContent>
    </Card>
  {/if}
</div>
