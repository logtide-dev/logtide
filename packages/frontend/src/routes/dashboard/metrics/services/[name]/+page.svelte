<script lang="ts">
  import { page } from '$app/state';
  import SourceDetailView from '$lib/components/metrics/sources/SourceDetailView.svelte';

  const name = $derived((page.params as Record<string, string>).name ?? '');
</script>

{#key name}
  <SourceDetailView kind="service" {name} />
{/key}
