<script lang="ts">
  // Test double for the routing preview line.
  let { eventType }: { eventType: string } = $props();
</script>

<p data-testid="will-notify" data-event-type={eventType}>Will notify</p>
