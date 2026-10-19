<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { authStore } from '$lib/stores/auth';
  import { authAPI } from '$lib/api/auth';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import MailCheck from '@lucide/svelte/icons/mail-check';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';

  let status = $state<'working' | 'done' | 'error'>('working');
  let errorMessage = $state('');
  let signedIn = $derived(!!$authStore.token);

  onMount(async () => {
    const token = page.url.searchParams.get('token');
    if (!token) {
      status = 'error';
      errorMessage = 'This verification link is missing its token.';
      return;
    }

    try {
      await authAPI.verifyEmail(token, $authStore.token);
      status = 'done';
    } catch (e) {
      status = 'error';
      errorMessage = e instanceof Error ? e.message : 'This verification link is invalid or expired.';
    }
  });
</script>

<svelte:head>
  <title>Verify email - LogTide</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-background px-4">
  <Card class="w-full max-w-md">
    <CardHeader class="text-center">
      <div class="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        {#if status === 'working'}
          <MailCheck class="h-6 w-6 text-muted-foreground" />
        {:else if status === 'done'}
          <CircleCheck class="h-6 w-6 text-green-600" />
        {:else}
          <CircleAlert class="h-6 w-6 text-destructive" />
        {/if}
      </div>
      <CardTitle>
        {#if status === 'working'}
          Verifying your email...
        {:else if status === 'done'}
          Email verified
        {:else}
          Verification failed
        {/if}
      </CardTitle>
      <CardDescription>
        {#if status === 'working'}
          One moment while we confirm your address.
        {:else if status === 'done'}
          Thanks, your email address is confirmed. You can now create projects and API keys.
        {:else}
          {errorMessage}
        {/if}
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
      {#if status === 'done'}
        <Button href={signedIn ? '/dashboard' : '/login'}>
          {signedIn ? 'Go to dashboard' : 'Sign in'}
        </Button>
      {:else if status === 'error'}
        {#if signedIn}
          <p>Use "Resend email" in the banner on your dashboard to get a new link.</p>
          <Button variant="outline" href="/dashboard">Go to dashboard</Button>
        {:else}
          <p>Sign in to request a new verification link.</p>
          <Button variant="outline" href="/login">Sign in</Button>
        {/if}
      {/if}
    </CardContent>
  </Card>
</div>
