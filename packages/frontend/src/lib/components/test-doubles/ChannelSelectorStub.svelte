<script lang="ts">
  // Test double for the store-backed channel selector.
  let { ...rest }: Record<string, unknown> = $props();
</script>

<div data-testid="channel-selector" data-props={Object.keys(rest).join(',')}></div>
