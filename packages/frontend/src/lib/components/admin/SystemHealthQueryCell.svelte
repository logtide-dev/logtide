<script lang="ts">
  import CopyButton from '$lib/components/app/CopyButton.svelte';

  let { query }: { query: string } = $props();
  let expanded = $state(false);
  const long = $derived(query.length > 80 || query.includes('\n'));
</script>

<div class="flex items-start gap-1">
  <div class="min-w-0 flex-1">
    <pre
      class="font-mono text-xs whitespace-pre-wrap break-all {expanded ? '' : 'line-clamp-1'}">{query}</pre>
    {#if long}
      <button
        type="button"
        class="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
        onclick={() => (expanded = !expanded)}
      >
        {expanded ? 'Show less' : 'Show full query'}
      </button>
    {/if}
  </div>
  <CopyButton value={query} ariaLabel="Copy query" />
</div>
