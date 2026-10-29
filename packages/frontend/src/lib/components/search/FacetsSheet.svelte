<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Dialog from "$lib/components/ui/dialog";
  import Button from "$lib/components/ui/button/button.svelte";

  interface Props {
    open: boolean;
    children: Snippet;
  }

  let { open = $bindable(false), children }: Props = $props();
</script>

<!-- Phone-only full-height panel for the facets. Picking a value keeps it open. -->
<Dialog.Root bind:open>
  <Dialog.Content
    data-testid="facets-sheet"
    class="inset-0 flex h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0 data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-top-0 sm:rounded-none"
  >
    <Dialog.Header class="border-b px-4 py-3 pr-12 text-left">
      <Dialog.Title>Filters</Dialog.Title>
      <Dialog.Description class="sr-only">Pick values to filter the logs. The list updates as you pick.</Dialog.Description>
    </Dialog.Header>
    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {@render children()}
    </div>
    <div class="border-t p-3">
      <Dialog.Close>
        {#snippet child({ props })}
          <Button {...props} class="w-full">Done</Button>
        {/snippet}
      </Dialog.Close>
    </div>
  </Dialog.Content>
</Dialog.Root>
