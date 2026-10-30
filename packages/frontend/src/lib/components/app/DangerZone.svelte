<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();
</script>

<section aria-label="Danger zone" class="space-y-3 rounded-lg border border-destructive/40 p-4 sm:p-6">
  <h2 class="text-lg font-semibold text-destructive-text">Danger zone</h2>
  <div class="space-y-4">
    {@render children?.()}
  </div>
</section>
