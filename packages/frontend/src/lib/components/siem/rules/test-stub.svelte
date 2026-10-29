<script lang="ts">
  // Test double for components that talk to stores or the network.
  let { ...rest }: Record<string, unknown> = $props();
</script>

<div data-testid="stub" data-props={Object.keys(rest).join(',')}></div>
