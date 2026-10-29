<script lang="ts">
  import { currentOrganization } from '$lib/stores/organization';
  let { variant }: { variant?: string } = $props();
</script>

<button data-testid="org-switcher" data-variant={variant} title={$currentOrganization?.name}>
  {$currentOrganization?.name}
</button>
