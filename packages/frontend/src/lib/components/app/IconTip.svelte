<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';

  interface Props {
    /** Text shown on hover and keyboard focus. */
    label: string;
    /** The trigger element; spread `props` on it (e.g. a Button). */
    trigger: Snippet<[{ props: Record<string, unknown> }]>;
  }

  let { label, trigger }: Props = $props();
</script>

<!-- Own provider so the tip works in any tree (dialogs, tests), not only under AppLayout. -->
<Tooltip.Provider delayDuration={300}>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        {@render trigger({ props })}
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>
      <p class="text-xs">{label}</p>
    </Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>
