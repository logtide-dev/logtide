<script lang="ts">
  import { page } from '$app/stores';
  import SubscriptionAction from '$lib/components/monitoring/public/SubscriptionAction.svelte';
</script>

<svelte:head>
  <title>Confirm subscription - Status</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-lg px-3 sm:px-6">
  <SubscriptionAction
    orgSlug={$page.params.orgSlug ?? ''}
    projectSlug={$page.params.projectSlug ?? ''}
    token={$page.url.searchParams.get('token') ?? ''}
    action="confirm"
  />
</div>
