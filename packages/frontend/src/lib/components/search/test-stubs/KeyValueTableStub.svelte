<script lang="ts">
  // Test double for F1's KeyValueTable: fixed buttons that fire the callbacks
  // with known paths and raw (non-string) values.
  interface Props {
    data: Record<string, unknown>;
    onFilter?: (path: string, value: unknown, negate: boolean) => void;
    onAddColumn?: (path: string) => void;
  }

  let { data, onFilter, onAddColumn }: Props = $props();
</script>

<div data-testid="kv-stub" data-keys={Object.keys(data ?? {}).join(',')}>
  <button type="button" onclick={() => onFilter?.('user.id', 42, false)}>stub filter</button>
  <button type="button" onclick={() => onFilter?.('user.id', 42, true)}>stub exclude</button>
  <button type="button" onclick={() => onFilter?.('user.id', null, false)}>stub filter null</button>
  <button type="button" onclick={() => onAddColumn?.('user.id')}>stub add column</button>
</div>
