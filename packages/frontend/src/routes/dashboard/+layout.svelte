<script lang="ts">
  import AppLayout from '$lib/components/AppLayout.svelte';
  import RequireOrganization from '$lib/components/RequireOrganization.svelte';
</script>

<AppLayout>
  <RequireOrganization>
    <slot />
  </RequireOrganization>
</AppLayout>
