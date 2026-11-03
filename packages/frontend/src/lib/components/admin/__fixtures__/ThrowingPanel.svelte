<script lang="ts">
  let { orgId }: { orgId: string } = $props();
  const value = $derived.by(() => {
    throw new Error(`panel exploded for ${orgId}`);
  });
</script>

<p>{value}</p>
