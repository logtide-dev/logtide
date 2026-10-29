<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    description?: string;
    children?: Snippet;
  }

  let { title, description, children }: Props = $props();

  const uid = $props.id();
  const headingId = `settings-section-${uid}`;
</script>

<section aria-labelledby={headingId} class="space-y-3">
  <div class="space-y-1">
    <h2 id={headingId} class="text-lg font-semibold">{title}</h2>
    {#if description}
      <p class="text-sm text-muted-foreground">{description}</p>
    {/if}
  </div>
  <div class="rounded-lg border border-border bg-card p-4 sm:p-6">
    {@render children?.()}
  </div>
</section>
