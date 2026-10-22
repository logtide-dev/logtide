<script lang="ts">
  import { page } from '$app/state';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { toastStore } from '$lib/stores/toast';
  import { copyToClipboard } from '$lib/utils/clipboard';
  import { APP_VERSION } from '$lib/components/Footer.svelte';
  import { buildErrorDetails } from './error-details';

  interface Props {
    error: unknown;
    reset: () => void;
  }

  let { error, reset }: Props = $props();

  // Shown only when the clipboard is blocked, so the text can be selected by hand.
  let showDetails = $state(false);

  function details(): string {
    return buildErrorDetails(error, { pathname: page.url.pathname, version: APP_VERSION });
  }

  let detailsText = $derived(showDetails ? details() : '');

  async function copyDetails() {
    const ok = await copyToClipboard(details());
    if (ok) {
      toastStore.success('Error details copied');
    } else {
      showDetails = true;
      toastStore.error('Could not copy, select the details below');
    }
  }
</script>

<div class="flex-1 p-6 sm:p-8">
  <div class="mx-auto max-w-2xl space-y-4">
    <EmptyState
      variant="error"
      title="This page failed to load"
      description="Something went wrong while rendering this page. Retry, or copy the error details for a bug report."
    >
      {#snippet actions()}
        <Button onclick={reset}>Retry</Button>
        <Button variant="outline" onclick={copyDetails}>Copy error details</Button>
      {/snippet}
    </EmptyState>
    {#if showDetails}
      <pre
        data-testid="error-details"
        class="max-h-64 overflow-auto rounded-md border border-border bg-muted p-3 text-left text-xs select-text whitespace-pre-wrap break-words">{detailsText}</pre>
    {/if}
  </div>
</div>
