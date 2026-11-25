<script lang="ts">
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import { Button } from '$lib/components/ui/button';
  import { copyToClipboard } from '$lib/utils/clipboard';
  import IconTip from './IconTip.svelte';

  interface Props {
    value: string;
    label?: string;
    class?: string;
    /** Accessible name for the icon-only variant (defaults to Copy). */
    ariaLabel?: string;
    /** Hover/focus tip for the icon-only variant. */
    tooltip?: string;
  }

  let { value, label, ariaLabel, tooltip, class: className }: Props = $props();

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

  const name = $derived(copied ? 'Copied' : (label ?? ariaLabel ?? 'Copy'));
</script>

{#if label}
  <Button variant="ghost" size="sm" class={className} onclick={copy} aria-label={name}>
    {#if copied}<Check />{:else}<Copy />{/if}
    {name}
  </Button>
{:else if tooltip}
  <IconTip label={copied ? 'Copied' : tooltip}>
    {#snippet trigger({ props })}
      <Button {...props} variant="ghost" size="icon" class="size-8" onclick={copy} aria-label={name}>
        {#if copied}<Check />{:else}<Copy />{/if}
      </Button>
    {/snippet}
  </IconTip>
{:else}
  <Button variant="ghost" size="icon" class="size-8" onclick={copy} aria-label={name}>
    {#if copied}<Check />{:else}<Copy />{/if}
  </Button>
{/if}
