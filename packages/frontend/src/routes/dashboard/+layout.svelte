<script lang="ts">
  import AppLayout from '$lib/components/AppLayout.svelte';
  import RequireOrganization from '$lib/components/RequireOrganization.svelte';
  import DashboardErrorState from '$lib/components/shell/DashboardErrorState.svelte';
  import { createBoundaryHandler } from '@logtide/sveltekit';

  const onerror = createBoundaryHandler('Dashboard');
</script>

<AppLayout>
  <RequireOrganization>
    <svelte:boundary {onerror}>
      <slot />
      {#snippet failed(error, reset)}
        <DashboardErrorState {error} {reset} />
      {/snippet}
    </svelte:boundary>
  </RequireOrganization>
</AppLayout>
