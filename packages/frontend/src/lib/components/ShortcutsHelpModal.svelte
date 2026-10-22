<script lang="ts">
  import { shortcutsStore, type Shortcut } from '$lib/stores/shortcuts';
  import { formatKey } from '$lib/utils/keyboard';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Separator } from '$lib/components/ui/separator';

  let open = $state(false);
  let grouped = $state<Record<string, Shortcut[]>>({});

  $effect(() => {
    const unsubscribe = shortcutsStore.subscribe((s) => {
      open = s.helpModalOpen;
    });
    return unsubscribe;
  });

  $effect(() => {
    const unsubscribe = shortcutsStore.grouped.subscribe((g) => {
      grouped = g;
    });
    return unsubscribe;
  });

  function handleOpenChange(newOpen: boolean) {
    if (newOpen) {
      shortcutsStore.openHelpModal();
    } else {
      shortcutsStore.closeHelpModal();
    }
  }

  const categoryLabels: Record<string, string> = {
    navigation: 'Navigation',
    actions: 'Actions',
    search: 'Search and filters',
    time: 'Time ranges',
  };

  const categoryOrder = ['navigation', 'actions', 'search', 'time'];
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
  <Dialog.Content class="max-w-2xl max-h-[80vh] overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>Keyboard shortcuts</Dialog.Title>
      <Dialog.Description>
        Navigate faster with the keyboard
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-5 py-2">
      {#each categoryOrder as category, i}
        {#if grouped[category]?.some((s) => s.combo !== 'escape')}
          <div>
            <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {categoryLabels[category] ?? category}
            </h3>
            <div class="space-y-0.5">
              {#each grouped[category].filter(s => s.combo !== 'escape') as shortcut (shortcut.id)}
                <div class="flex items-center justify-between py-1.5 px-3 rounded-md hover:bg-accent/50 transition-colors">
                  <span class="text-sm">{shortcut.label}</span>
                  <kbd class="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border bg-muted text-muted-foreground text-xs font-mono">
                    {formatKey(shortcut.combo)}
                  </kbd>
                </div>
              {/each}
            </div>
          </div>
          {#if i < categoryOrder.length - 1 && grouped[categoryOrder[i + 1]]?.length}
            <Separator />
          {/if}
        {/if}
      {/each}
    </div>

    <Dialog.Footer>
      <p class="text-xs text-muted-foreground">
        Press <kbd class="inline-flex items-center px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground text-xs font-mono mx-0.5">?</kbd> anytime to show this dialog
      </p>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
