<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Crumb {
    label: string;
    href?: string;
  }

  interface Props {
    title: string;
    description?: string;
    appliesTo?: 'you' | 'organization' | 'project' | 'instance';
    breadcrumbs?: Crumb[];
    actions?: Snippet;
    meta?: Snippet;
  }

  let { title, description, appliesTo, breadcrumbs, actions, meta }: Props = $props();

  const APPLIES_LABELS = {
    you: 'Applies to: You',
    organization: 'Applies to: Organization',
    project: 'Applies to: Project',
    instance: 'Applies to: Instance',
  } as const;
</script>

<header class="mb-6 space-y-2">
  {#if breadcrumbs && breadcrumbs.length > 0}
    <nav aria-label="Breadcrumb">
      <ol class="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        {#each breadcrumbs as crumb, i (i)}
          {@const last = i === breadcrumbs.length - 1}
          <li class="flex items-center gap-1.5">
            {#if crumb.href && !last}
              <a href={crumb.href} class="hover:text-foreground hover:underline">{crumb.label}</a>
            {:else}
              <span aria-current={last ? 'page' : undefined} class={last ? 'text-foreground' : ''}>
                {crumb.label}
              </span>
            {/if}
            {#if !last}<span aria-hidden="true">/</span>{/if}
          </li>
        {/each}
      </ol>
    </nav>
  {/if}

  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0 space-y-1">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
        {#if appliesTo}
          <span
            class="inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
          >
            {APPLIES_LABELS[appliesTo]}
          </span>
        {/if}
        {@render meta?.()}
      </div>
      {#if description}
        <p class="text-sm text-muted-foreground">{description}</p>
      {/if}
    </div>
    {#if actions}
      <div class="flex flex-wrap items-center justify-end gap-2 max-md:w-full">
        {@render actions()}
      </div>
    {/if}
  </div>
</header>
