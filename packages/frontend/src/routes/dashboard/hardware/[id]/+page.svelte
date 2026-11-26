<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { getHardwareHost } from '$lib/api/hardware';
  import { hardwareHostHref } from '$lib/components/hardware/hardware-meta';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Button from '$lib/components/ui/button/button.svelte';

  // The hardware host detail lives in the Hardware tab of the host page (1.8).
  // Only the API knows the host name behind an id, so this redirect is client side.
  let error = $state<string | null>(null);
  const hostId = $derived(page.params.id);

  $effect(() => {
    const id = hostId;
    if (!id) return;
    let cancelled = false;
    error = null;
    getHardwareHost(id)
      .then((res) => {
        if (cancelled) return;
        // Same target as a row of the Hardware list, keeping the rest of the query.
        const target = new URL(hardwareHostHref(res.host), page.url);
        for (const [key, value] of new URLSearchParams(page.url.search)) {
          if (!target.searchParams.has(key)) target.searchParams.append(key, value);
        }
        void goto(`${target.pathname}${target.search}`, { replaceState: true });
      })
      .catch((err) => {
        if (!cancelled) error = err instanceof Error ? err.message : 'Could not load this host';
      });
    return () => {
      cancelled = true;
    };
  });
</script>

<svelte:head>
  <title>Host - LogTide</title>
</svelte:head>

<div class="p-6">
  {#if error}
    <EmptyState variant="error" title="Could not open this host" description={error}>
      {#snippet actions()}
        <Button variant="outline" size="sm" href="/dashboard/hardware">Back to Hardware</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <div class="py-16 text-center text-sm text-muted-foreground" role="status">Opening the host</div>
  {/if}
</div>
