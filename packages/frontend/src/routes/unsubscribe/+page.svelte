<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { digestsAPI } from '$lib/api/digests';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import MailX from '@lucide/svelte/icons/mail-x';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';

  let status = $state<'working' | 'done' | 'error'>('working');
  let maskedEmail = $state('');
  let errorMessage = $state('');

  onMount(async () => {
    const token = page.url.searchParams.get('token');
    if (!token) {
      status = 'error';
      errorMessage = 'This unsubscribe link is missing its token.';
      return;
    }

    try {
      const result = await digestsAPI.unsubscribe(token);
      maskedEmail = result.email;
      status = 'done';
    } catch (e) {
      status = 'error';
      errorMessage = e instanceof Error ? e.message : 'Invalid or expired unsubscribe link';
    }
  });
</script>

<svelte:head>
  <title>Unsubscribe - LogTide</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-background px-4">
  <Card class="w-full max-w-md">
    <CardHeader class="text-center">
      <div class="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        {#if status === 'working'}
          <MailX class="h-6 w-6 text-muted-foreground" />
        {:else if status === 'done'}
          <CircleCheck class="h-6 w-6 text-green-600" />
        {:else}
          <CircleAlert class="h-6 w-6 text-destructive" />
        {/if}
      </div>
      <CardTitle>
        {#if status === 'working'}
          Unsubscribing...
        {:else if status === 'done'}
          You are unsubscribed
        {:else}
          Something went wrong
        {/if}
      </CardTitle>
      <CardDescription>
        {#if status === 'working'}
          One moment while we update your preferences.
        {:else if status === 'done'}
          {maskedEmail} will no longer receive digest reports from this organization.
        {:else}
          {errorMessage}
        {/if}
      </CardDescription>
    </CardHeader>
    <CardContent class="text-center text-sm text-muted-foreground">
      {#if status === 'done'}
        Changed your mind? An organization admin can resubscribe you from the digest settings.
      {:else if status === 'error'}
        If you keep receiving digests, ask an organization admin to remove your address.
      {/if}
    </CardContent>
  </Card>
</div>
