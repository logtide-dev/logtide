<script lang="ts">
  import { BRANDS, type BrandMark, type BrandSlug } from './brands';

  interface Props {
    brand: BrandSlug;
    class?: string;
    /** Accessible name; leave empty when a visible label sits next to the mark. */
    title?: string;
  }

  let { brand, class: className = 'size-4', title }: Props = $props();

  const mark: BrandMark = $derived(BRANDS[brand]);
</script>

<svg
  viewBox="0 0 24 24"
  class="shrink-0 fill-[var(--brand)] {mark.lowContrastOnDark ? 'dark:fill-current' : ''} {className}"
  style="--brand: #{mark.hex}"
  role={title ? 'img' : undefined}
  aria-label={title || undefined}
  aria-hidden={title ? undefined : 'true'}
  data-brand={brand}
>
  {#if title}<title>{title}</title>{/if}
  <path d={mark.path} />
</svg>
