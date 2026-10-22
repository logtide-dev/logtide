<script lang="ts">
  import { untrack } from 'svelte';
  import { confirmStatusSubscription, unsubscribeFromStatusPage } from '$lib/api/status-page';

  interface Props {
    orgSlug: string;
    projectSlug: string;
    token: string;
    action: 'confirm' | 'unsubscribe';
  }

  let { orgSlug, projectSlug, token, action }: Props = $props();

  let phase = $state<'working' | 'done' | 'invalid'>('working');

  // The link opens this page and the page does the POST, so a mail scanner that
  // only fetches the URL never confirms or unsubscribes anyone.
  async function run() {
    if (!token) {
      phase = 'invalid';
      return;
    }
    try {
      if (action === 'confirm') await confirmStatusSubscription(orgSlug, projectSlug, token);
      else await unsubscribeFromStatusPage(orgSlug, projectSlug, token);
      phase = 'done';
    } catch {
      phase = 'invalid';
    }
  }

  $effect(() => {
    orgSlug;
    projectSlug;
    token;
    action;
    untrack(run);
  });
</script>

<div class="py-24 text-center" role="status">
  {#if phase === 'working'}
    <div class="mx-auto h-8 w-8 animate-spin rounded-full border-[3px] border-muted border-t-primary"></div>
    <p class="mt-4 text-sm text-muted-foreground">
      {action === 'confirm' ? 'Confirming your subscription...' : 'Unsubscribing...'}
    </p>
  {:else if phase === 'done'}
    <h1 class="mb-2 text-xl font-semibold">
      {action === 'confirm' ? 'Subscription confirmed' : 'You are unsubscribed'}
    </h1>
    <p class="text-sm text-muted-foreground">
      {action === 'confirm'
        ? 'You will get an email when the status changes.'
        : 'You will no longer get status emails.'}
    </p>
  {:else}
    <h1 class="mb-2 text-xl font-semibold">This link is invalid or has expired</h1>
    <p class="text-sm text-muted-foreground">
      {action === 'confirm' ? 'Subscribe again from the status page to get a new link.' : 'You may already be unsubscribed.'}
    </p>
  {/if}
  <a
    href="/status/{encodeURIComponent(orgSlug)}/{encodeURIComponent(projectSlug)}"
    class="mt-6 inline-block text-sm text-primary underline-offset-2 hover:underline"
  >
    Back to the status page
  </a>
</div>
