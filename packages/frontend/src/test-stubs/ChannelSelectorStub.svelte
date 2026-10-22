<script lang="ts">
  // Test stand-in for ChannelSelector: one button per fake channel.
  interface Props {
    selectedIds: string[];
    onSelectionChange: (ids: string[]) => void;
  }
  let { selectedIds, onSelectionChange }: Props = $props();
</script>

<div data-testid="channel-selector" data-selected={selectedIds.join(',')}>
  <button type="button" onclick={() => onSelectionChange([...selectedIds, 'ch-1'])}>Pick channel one</button>
  <button type="button" onclick={() => onSelectionChange([])}>Clear channels</button>
</div>
