<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import Check from '@lucide/svelte/icons/check';
  import type { OnboardingStep } from '$lib/stores/onboarding';
  import { smallLogoPath } from '$lib/utils/theme';

  interface Props {
    step: OnboardingStep;
    /** Whether the verify email step is part of this run. */
    showVerify?: boolean;
    class?: string;
    children?: Snippet;
  }

  let { step, showVerify = false, class: className = '', children }: Props = $props();

  const LABELS: Record<OnboardingStep, string> = {
    'verify-email': 'Verify email',
    workspace: 'Workspace',
    connect: 'Connect',
    done: 'Done',
  };

  const visibleSteps = $derived(
    (['verify-email', 'workspace', 'connect', 'done'] as OnboardingStep[]).filter(
      (s) => s !== 'verify-email' || showVerify
    )
  );
  const currentIndex = $derived(Math.max(0, visibleSteps.indexOf(step)));
  const progressPercent = $derived(((currentIndex + 1) / visibleSteps.length) * 100);
</script>

<div class="flex min-h-screen flex-col bg-background {className}">
  <header class="sticky top-0 z-50 border-b bg-card/50 backdrop-blur-sm">
    <div class="mx-auto max-w-4xl px-4 py-3">
      <div class="mb-3 flex items-center gap-3">
        <img src={$smallLogoPath} alt="LogTide" class="h-8 w-auto" />
        <span class="text-sm text-muted-foreground">Getting started</span>
      </div>

      <div
        class="h-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progressPercent)}
      >
        <div
          class="h-full bg-primary transition-all duration-500 ease-out"
          style="width: {progressPercent}%"
        ></div>
      </div>

      <ol class="mt-2 flex justify-between">
        {#each visibleSteps as s, index (s)}
          <li class="flex flex-col items-center" aria-current={s === step ? 'step' : undefined}>
            <span
              class="flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium transition-all duration-300
                {index < currentIndex
                  ? 'bg-primary text-primary-foreground'
                  : index === currentIndex
                    ? 'border-2 border-primary bg-primary/20 text-primary-text'
                    : 'bg-muted text-muted-foreground'}"
            >
              {#if index < currentIndex}
                <Check class="h-3 w-3" aria-hidden="true" />
              {:else}
                {index + 1}
              {/if}
            </span>
            <span
              class="mt-1 hidden text-xs transition-colors sm:block
                {index === currentIndex ? 'font-medium text-primary-text' : 'text-muted-foreground'}"
            >
              {LABELS[s]}
            </span>
          </li>
        {/each}
      </ol>
    </div>
  </header>

  <main class="flex flex-1 items-center justify-center p-4">
    <div class="w-full max-w-2xl" in:fly={{ y: 20, duration: 400, easing: quintOut }}>
      {#if children}
        {@render children()}
      {/if}
    </div>
  </main>
</div>
