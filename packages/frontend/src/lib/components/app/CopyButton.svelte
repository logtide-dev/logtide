<script lang="ts">
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import { Button } from '$lib/components/ui/button';
  import { copyToClipboard } from '$lib/utils/clipboard';

  interface Props {
    value: string;
    label?: string;
  }

  let { value, label }: Props = $props();

  let copied = $state(false);

  $effect(() => {
    if (!copied) return;
    const t = setTimeout(() => {
      copied = false;
    }, 1500);
    return () => clearTimeout(t);
  });

  async function copy() {
    const ok = await copyToClipboard(value);
    if (ok) copied = true;
  }

  const name = $derived(copied ? 'Copied' : (label ?? 'Copy'));
</script>

{#if label}
  <Button variant="ghost" size="sm" onclick={copy} aria-label={name}>
    {#if copied}<Check />{:else}<Copy />{/if}
    {name}
  </Button>
{:else}
  <Button variant="ghost" size="icon" class="size-8" onclick={copy} aria-label={name}>
    {#if copied}<Check />{:else}<Copy />{/if}
  </Button>
{/if}
