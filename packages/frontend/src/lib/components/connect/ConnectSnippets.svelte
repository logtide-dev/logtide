<script lang="ts">
  import CopyButton from '$lib/components/app/CopyButton.svelte';
  import { getApiUrl } from '$lib/config';
  import { resolveEndpoints } from './endpoints';
  import { PLATFORMS, buildSnippets, type PlatformId } from './snippets';
  import { BrandIcon, platformBrand } from '$lib/components/brand';

  interface Props {
    apiKey: string | null;
    service?: string;
    platform?: PlatformId;
    /** Override for tests; defaults to getApiUrl(). */
    apiUrl?: string;
    /** Override for tests; defaults to window.location.origin. */
    origin?: string;
  }

  let {
    apiKey,
    service = 'my-app',
    platform = $bindable('nodejs'),
    apiUrl,
    origin,
  }: Props = $props();

  const endpoints = $derived(
    resolveEndpoints(
      apiUrl ?? getApiUrl(),
      origin ?? (typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
    )
  );
  const snippets = $derived(buildSnippets(platform, { endpoints, apiKey, service }));

  function onKeydown(event: KeyboardEvent, index: number) {
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % PLATFORMS.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = (index - 1 + PLATFORMS.length) % PLATFORMS.length;
    else return;
    event.preventDefault();
    platform = PLATFORMS[next].id;
    const group = (event.currentTarget as HTMLElement).parentElement;
    (group?.children[next] as HTMLElement | undefined)?.focus();
  }
</script>

<div class="space-y-4">
  <div role="radiogroup" aria-label="Platform" class="flex flex-wrap gap-2">
    {#each PLATFORMS as p, i (p.id)}
      {@const brand = platformBrand(p.id)}
      <button
        type="button"
        role="radio"
        aria-checked={platform === p.id}
        tabindex={platform === p.id ? 0 : -1}
        class="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {platform === p.id
          ? 'border-primary bg-primary/10 text-primary-text'
          : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'}"
        onclick={() => (platform = p.id)}
        onkeydown={(event) => onKeydown(event, i)}
      >
        {#if brand}<BrandIcon {brand} />{/if}
        {p.label}
      </button>
    {/each}
  </div>

  {#each snippets as snippet (snippet.title)}
    <div class="space-y-1.5">
      <p class="text-sm font-medium">{snippet.title}</p>
      <div class="relative rounded-md border border-border bg-muted/50">
        <div class="absolute right-1 top-1">
          <CopyButton value={snippet.code} ariaLabel="Copy {snippet.title.toLowerCase()}" />
        </div>
        <pre
          class="overflow-x-auto p-4 pr-12 text-xs leading-relaxed"
          data-language={snippet.language}><code>{snippet.code}</code></pre>
      </div>
    </div>
  {/each}
</div>
