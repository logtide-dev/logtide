<script lang="ts">
  import Input from '$lib/components/ui/input/input.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import { moveRow, type ComponentRow } from './status-page-form';

  interface Props {
    rows: ComponentRow[];
    disabled?: boolean;
  }

  let { rows = $bindable(), disabled = false }: Props = $props();

  function move(index: number, delta: -1 | 1) {
    rows = moveRow(rows, index, delta);
  }
</script>

<section class="space-y-3 rounded-lg border bg-card px-4 py-4" aria-labelledby="sp-components-heading">
  <div>
    <h3 id="sp-components-heading" class="text-sm font-semibold">Components</h3>
    <p class="text-xs text-muted-foreground">
      Monitors are listed on the status page in this order. Components with the same group name are shown together.
    </p>
  </div>

  {#if rows.length === 0}
    <p class="text-sm text-muted-foreground">Create a monitor to show it on the status page.</p>
  {:else}
    <ul class="space-y-2">
      {#each rows as row, i (row.monitorId)}
        <li class="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2" data-testid="component-row">
          <div class="flex flex-col">
            <Button
              variant="ghost"
              size="icon"
              class="h-6 w-6"
              disabled={disabled || i === 0}
              onclick={() => move(i, -1)}
              aria-label="Move {row.name} up"
            >
              <ArrowUp class="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="h-6 w-6"
              disabled={disabled || i === rows.length - 1}
              onclick={() => move(i, 1)}
              aria-label="Move {row.name} down"
            >
              <ArrowDown class="h-3.5 w-3.5" />
            </Button>
          </div>
          <span class="w-40 min-w-0 truncate text-sm font-medium" title={row.name}>{row.name}</span>
          <Input
            bind:value={row.displayName}
            {disabled}
            maxlength={255}
            placeholder="Public name"
            aria-label="Public name for {row.name}"
            class="h-8 min-w-40 flex-1"
          />
          <Input
            bind:value={row.groupName}
            {disabled}
            maxlength={100}
            placeholder="Group"
            aria-label="Group for {row.name}"
            class="h-8 w-40"
          />
        </li>
      {/each}
    </ul>
  {/if}
</section>
