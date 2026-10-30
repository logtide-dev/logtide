<script lang="ts">
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import { readableForeground } from './contrast';
  import { accentContrastWarning, validateBranding, type BrandingDraft } from './status-page-form';

  interface Props {
    draft: BrandingDraft;
    disabled?: boolean;
  }

  let { draft = $bindable(), disabled = false }: Props = $props();

  const errors = $derived(validateBranding(draft));
  const warning = $derived(errors.accentColor ? null : accentContrastWarning(draft.accentColor));
  const accent = $derived(errors.accentColor ? '' : draft.accentColor.trim());
  const previewText = $derived(accent ? readableForeground(accent) : null);

  let failedLogo = $state<string | null>(null);
  const logoShown = $derived(
    draft.logoUrl.trim() !== '' && !errors.logoUrl && failedLogo !== draft.logoUrl.trim()
  );
</script>

<section class="space-y-4 rounded-lg border bg-card px-4 py-4" aria-labelledby="sp-branding-heading">
  <h3 id="sp-branding-heading" class="text-sm font-semibold">Branding</h3>

  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <div class="space-y-1.5">
      <Label for="sp-title">Title</Label>
      <Input
        id="sp-title"
        bind:value={draft.title}
        {disabled}
        placeholder="Defaults to the project name"
        aria-invalid={errors.title ? 'true' : undefined}
      />
      {#if errors.title}<p class="text-xs text-destructive-text">{errors.title}</p>{/if}
    </div>
    <div class="space-y-1.5">
      <Label for="sp-accent">Accent colour</Label>
      <div class="flex items-center gap-2">
        <Input
          id="sp-accent"
          bind:value={draft.accentColor}
          {disabled}
          placeholder="#2563eb"
          aria-invalid={errors.accentColor ? 'true' : undefined}
        />
        {#if accent}
          <span
            class="h-8 w-8 shrink-0 rounded-md border"
            style="background-color: {accent}"
            aria-hidden="true"
          ></span>
        {/if}
      </div>
      {#if errors.accentColor}<p class="text-xs text-destructive-text">{errors.accentColor}</p>{/if}
      {#if warning}<p class="text-xs text-warning-text" role="status">{warning}</p>{/if}
    </div>
    <div class="space-y-1.5 sm:col-span-2">
      <Label for="sp-description">Description</Label>
      <textarea
        id="sp-description"
        bind:value={draft.description}
        {disabled}
        rows="2"
        class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        aria-invalid={errors.description ? 'true' : undefined}
      ></textarea>
      {#if errors.description}<p class="text-xs text-destructive-text">{errors.description}</p>{/if}
    </div>
    <div class="space-y-1.5 sm:col-span-2">
      <Label for="sp-logo">Logo URL</Label>
      <Input
        id="sp-logo"
        bind:value={draft.logoUrl}
        {disabled}
        placeholder="https://example.com/logo.png"
        aria-invalid={errors.logoUrl ? 'true' : undefined}
      />
      {#if errors.logoUrl}<p class="text-xs text-destructive-text">{errors.logoUrl}</p>{/if}
    </div>
    <label class="flex items-center gap-2 text-sm sm:col-span-2">
      <input type="checkbox" bind:checked={draft.showMonitorTypes} {disabled} class="rounded" />
      Show the monitor type next to each component
    </label>
  </div>

  <div class="rounded-md border bg-background p-3" data-testid="branding-preview">
    <p class="mb-2 text-xs font-medium text-muted-foreground">Preview</p>
    <div class="flex items-center gap-3">
      {#if logoShown}
        <img
          src={draft.logoUrl.trim()}
          alt=""
          class="h-8 max-w-32 object-contain"
          onerror={() => (failedLogo = draft.logoUrl.trim())}
        />
      {/if}
      <span class="text-base font-semibold">{draft.title.trim() || 'Project name'}</span>
      <span
        class="ml-auto rounded-md px-3 py-1 text-xs font-medium {accent ? '' : 'bg-primary text-primary-foreground'}"
        style={accent && previewText ? `background-color: ${accent}; color: ${previewText}` : undefined}
      >
        Subscribe
      </span>
    </div>
  </div>
</section>
