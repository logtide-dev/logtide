<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { getHardwareHost } from '$lib/api/hardware';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Button from '$lib/components/ui/button/button.svelte';

  // The hardware host page moved to the host page of Metrics (Hardware tab).
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
        const params = new URLSearchParams(page.url.search);
        params.set('tab', 'hardware');
        if (res.host.projectId && !params.has('project')) params.set('project', res.host.projectId);
        void goto(`/dashboard/metrics/hosts/${encodeURIComponent(res.host.hostName)}?${params.toString()}`, {
          replaceState: true,
        });
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
        <Button variant="outline" size="sm" href="/dashboard/metrics?kind=host">Back to hosts</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <div class="py-16 text-center text-sm text-muted-foreground" role="status">Opening the host</div>
  {/if}
</div>
