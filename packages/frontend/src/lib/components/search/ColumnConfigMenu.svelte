<script lang="ts">
  import * as Popover from '$lib/components/ui/popover';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Columns3 from '@lucide/svelte/icons/columns-3';
  import X from '@lucide/svelte/icons/x';
  import Plus from '@lucide/svelte/icons/plus';

  interface Props {
    columns: string[];
    onchange?: (columns: string[]) => void;
  }

  let { columns = $bindable([]), onchange }: Props = $props();
  let newKey = $state('');

  function addKey() {
    const k = newKey.trim();
    if (!k || columns.includes(k)) return;
    columns = [...columns, k];
    newKey = '';
    onchange?.(columns);
  }

  function removeKey(k: string) {
    columns = columns.filter((c) => c !== k);
    onchange?.(columns);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKey();
    }
  }
</script>

<Popover.Root>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="outline"
        size="sm"
        class="gap-1.5"
        title="Configure metadata columns"
        aria-label="Configure metadata columns"
      >
        <Columns3 class="w-4 h-4" />
        <span class="hidden sm:inline">Columns</span>
        {#if columns.length > 0}
          <span class="ml-0.5 text-xs font-normal text-muted-foreground">({columns.length})</span>
        {/if}
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-[260px] p-3" align="end">
    <div class="space-y-3">
      <div>
        <p class="text-sm font-medium mb-1">Metadata columns</p>
        <p class="text-xs text-muted-foreground">Add metadata keys to show as extra columns in the table. Use dot notation to reach nested values (e.g. sdk.name).</p>
      </div>

      <div class="flex gap-1.5">
        <Input
          type="text"
          placeholder="e.g. sdk.name"
          bind:value={newKey}
          onkeydown={handleKeydown}
          class="h-8 text-sm"
        />
        <Button size="sm" class="h-8 px-2 shrink-0" onclick={addKey} disabled={!newKey.trim()}>
          <Plus class="w-4 h-4" />
        </Button>
      </div>

      {#if columns.length > 0}
        <div class="space-y-1">
          {#each columns as col (col)}
            <div class="flex items-center justify-between gap-1 rounded-md border bg-muted/40 px-2 py-1">
              <span class="text-xs font-mono truncate">{col}</span>
              <button
                onclick={() => removeKey(col)}
                class="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Remove {col} column"
              >
                <X class="w-3.5 h-3.5" />
              </button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-xs text-muted-foreground text-center py-1">No extra columns added yet.</p>
      {/if}
    </div>
  </Popover.Content>
</Popover.Root>
