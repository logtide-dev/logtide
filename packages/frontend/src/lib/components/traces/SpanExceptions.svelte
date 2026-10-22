<script lang="ts">
  import CopyButton from '$lib/components/app/CopyButton.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import { levelTone } from '$lib/utils/severity';
  import type { ExceptionInfo } from '$lib/utils/span-events';

  interface Props {
    exceptions: ExceptionInfo[];
  }

  let { exceptions }: Props = $props();
</script>

<div class="space-y-4">
  {#each exceptions as ex, i (i)}
    <section class="rounded-md border border-border p-3" aria-label="Exception {i + 1}">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h4 class="break-all font-mono text-sm font-semibold {levelTone('error').text}">
          {ex.type ?? 'Exception'}
        </h4>
        {#if ex.time}
          <span class="text-xs text-muted-foreground"><Timestamp value={ex.time} precision="ms" /></span>
        {/if}
      </div>
      {#if ex.message}
        <p class="mt-1 whitespace-pre-wrap break-words text-sm">{ex.message}</p>
      {/if}
      {#if ex.stacktrace}
        <div class="mt-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-muted-foreground">Stack trace</span>
            <CopyButton value={ex.stacktrace} ariaLabel="Copy stack trace" />
          </div>
          <pre
            class="mt-1 max-h-72 overflow-auto rounded bg-muted p-2 font-mono text-xs leading-relaxed"
          >{ex.stacktrace}</pre>
        </div>
      {:else}
        <p class="mt-2 text-xs text-muted-foreground">No stack trace recorded</p>
      {/if}
    </section>
  {/each}
</div>
