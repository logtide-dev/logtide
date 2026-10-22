<script lang="ts">
  // Test stand-in for WillNotify: exposes the props it receives as data attributes.
  interface Props {
    eventType: string;
    projectId?: string | null;
    channelIds?: string[];
  }
  let { eventType, projectId = null, channelIds = [] }: Props = $props();
</script>

<div
  data-testid="will-notify"
  data-event-type={eventType}
  data-project-id={projectId ?? ''}
  data-channel-ids={channelIds.join(',')}
></div>
