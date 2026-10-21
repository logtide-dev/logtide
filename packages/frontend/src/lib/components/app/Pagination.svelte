<script lang="ts">
  import { Button } from '$lib/components/ui/button';

  interface Props {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
  }

  let { page, pageSize, total, onPageChange }: Props = $props();

  const totalPages = $derived(Math.max(1, Math.ceil(total / Math.max(1, pageSize))));
  const current = $derived(Math.min(Math.max(1, page), totalPages));
  const from = $derived((current - 1) * pageSize + 1);
  const to = $derived(Math.min(current * pageSize, total));

  function go(next: number) {
    if (next < 1 || next > totalPages || next === current) return;
    onPageChange(next);
  }
</script>

{#if total > 0}
  <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
    <p>{from.toLocaleString('en-US')} to {to.toLocaleString('en-US')} of {total.toLocaleString('en-US')}</p>
    {#if totalPages > 1}
      <div class="flex items-center gap-2">
        <span>Page {current.toLocaleString('en-US')} of {totalPages.toLocaleString('en-US')}</span>
        <Button variant="outline" size="sm" disabled={current <= 1} onclick={() => go(current - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={current >= totalPages} onclick={() => go(current + 1)}>
          Next
        </Button>
      </div>
    {/if}
  </div>
{/if}
