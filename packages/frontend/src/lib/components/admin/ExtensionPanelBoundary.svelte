<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** Panel label, shown in the error line. */
    label: string;
    children: Snippet;
  }

  let { label, children }: Props = $props();
</script>

<!-- An extension panel that throws must not take the organization page down. -->
<svelte:boundary>
  {@render children()}
  {#snippet failed(error)}
    <p class="text-sm text-destructive" role="alert">
      Could not load {label}: {error instanceof Error ? error.message : String(error)}
    </p>
  {/snippet}
</svelte:boundary>
