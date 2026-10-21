<script lang="ts">
  import type { TimeRangePreset } from "@logtide/shared";
  import { resolveRange, type TimeRangeValue } from "$lib/stores/scope-url";
  import CustomRangeEditor from "./CustomRangeEditor.svelte";
  import { presetLabel } from "./labels.js";

  interface Props {
    value: TimeRangeValue;
    presets: TimeRangePreset[];
    zone: string;
    onSelect: (value: TimeRangeValue) => void;
  }

  let { value, presets, zone, onSelect }: Props = $props();

  // svelte-ignore state_referenced_locally
  let customOpen = $state(value.kind === "custom");
  let showCustom = $derived(customOpen || value.kind === "custom");
  let editorRange = $derived(resolveRange(value));

  const base = "rounded-md border px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted";

  function pickPreset(preset: TimeRangePreset) {
    customOpen = false;
    onSelect({ kind: "preset", preset });
  }

  function handleApply(range: { from: Date; to: Date }) {
    onSelect({ kind: "custom", from: range.from.toISOString(), to: range.to.toISOString() });
  }
</script>

<div class="space-y-3">
  <div class="grid grid-cols-2 gap-2">
    {#each presets as preset (preset)}
      {@const active = value.kind === "preset" && value.preset === preset}
      <button
        type="button"
        aria-pressed={active}
        class="{base} {active ? 'bg-muted font-medium' : 'text-muted-foreground'}"
        onclick={() => pickPreset(preset)}
      >
        {presetLabel(preset)}
      </button>
    {/each}
  </div>
  <button
    type="button"
    aria-pressed={showCustom}
    class="{base} w-full {showCustom ? 'bg-muted font-medium' : 'text-muted-foreground'}"
    onclick={() => (customOpen = !customOpen)}
  >
    Custom range
  </button>
  {#if showCustom}
    <CustomRangeEditor from={editorRange.from} to={editorRange.to} {zone} onApply={handleApply} />
  {/if}
</div>
