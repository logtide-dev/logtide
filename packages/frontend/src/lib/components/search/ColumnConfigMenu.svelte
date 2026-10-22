<script lang="ts">
  import * as Popover from '$lib/components/ui/popover';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import Columns3 from '@lucide/svelte/icons/columns-3';
  import X from '@lucide/svelte/icons/x';
  import Plus from '@lucide/svelte/icons/plus';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import {
    BUILTIN_COLUMN_LABELS,
    moveColumn,
    toggleColumn,
    type BuiltinColumn,
    type BuiltinColumnLayout,
  } from './builtin-columns';

  interface Props {
    /** Custom metadata columns of the active project. */
    columns: string[];
    onchange?: (columns: string[]) => void;
    /** Order and visibility of the built-in columns. */
    layout: BuiltinColumnLayout;
    onLayoutChange: (layout: BuiltinColumnLayout) => void;
  }

  let { columns = $bindable([]), onchange, layout, onLayoutChange }: Props = $props();
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

  function toggle(col: BuiltinColumn) {
    const next = toggleColumn(layout, col);
    if (next !== layout) onLayoutChange(next);
  }

  function move(col: BuiltinColumn, delta: -1 | 1) {
    const next = moveColumn(layout, col, delta);
    if (next !== layout) onLayoutChange(next);
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
        title="Configure columns"
        aria-label="Configure columns"
      >
        <Columns3 class="w-4 h-4" />
        <span class="hidden sm:inline">Columns</span>
        {#if columns.length > 0}
          <span class="ml-0.5 text-xs font-normal text-muted-foreground">({columns.length})</span>
        {/if}
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-[280px] p-3" align="end">
    <div class="space-y-4">
      <section class="space-y-2" aria-labelledby="builtin-columns-heading">
        <div>
          <p id="builtin-columns-heading" class="text-sm font-medium mb-1">Built-in columns</p>
          <p class="text-xs text-muted-foreground">Show, hide and reorder the standard columns. The message column always stays visible.</p>
        </div>
        <ul class="space-y-0.5">
          {#each layout.order as col, index (col)}
            {@const label = BUILTIN_COLUMN_LABELS[col]}
            {@const checkboxId = `builtin-column-${col}`}
            <li class="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/40">
              <Checkbox
                id={checkboxId}
                aria-label={label}
                checked={!layout.hidden.includes(col)}
                disabled={col === 'message'}
                onCheckedChange={() => toggle(col)}
              />
              <label for={checkboxId} class="flex-1 text-sm select-none">{label}</label>
              <Button
                variant="ghost"
                size="icon"
                class="h-6 w-6"
                aria-label="Move {label.toLowerCase()} column up"
                title="Move up"
                disabled={index === 0}
                onclick={() => move(col, -1)}
              >
                <ChevronUp class="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="h-6 w-6"
                aria-label="Move {label.toLowerCase()} column down"
                title="Move down"
                disabled={index === layout.order.length - 1}
                onclick={() => move(col, 1)}
              >
                <ChevronDown class="w-3.5 h-3.5" />
              </Button>
            </li>
          {/each}
        </ul>
      </section>

      <section class="space-y-3 border-t pt-3">
        <div>
          <p class="text-sm font-medium mb-1">Metadata columns</p>
          <p class="text-xs text-muted-foreground">Add metadata keys to show as extra columns in the table. Use dot notation to reach nested values (e.g. sdk.name).</p>
        </div>

        <div class="flex gap-1.5">
          <Input
            type="text"
            placeholder="e.g. sdk.name"
            aria-label="Metadata key"
            bind:value={newKey}
            onkeydown={handleKeydown}
            class="h-8 text-sm"
          />
          <Button
            size="sm"
            class="h-8 px-2 shrink-0"
            onclick={addKey}
            disabled={!newKey.trim()}
            aria-label="Add column"
            title="Add column"
          >
            <Plus class="w-4 h-4" />
          </Button>
        </div>

        {#if columns.length > 0}
          <div class="space-y-1">
            {#each columns as col (col)}
              <div class="flex items-center justify-between gap-1 rounded-md border bg-muted/40 px-2 py-1">
                <span class="text-xs font-mono truncate">{col}</span>
                <button
                  type="button"
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
      </section>
    </div>
  </Popover.Content>
</Popover.Root>
