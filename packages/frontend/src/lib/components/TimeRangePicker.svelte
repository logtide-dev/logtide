<script lang="ts">
  import { TIME_RANGE_PRESETS, type TimeRangePreset } from "@logtide/shared";
  import Button from "$lib/components/ui/button/button.svelte";
  import * as Popover from "$lib/components/ui/popover";
  import Clock from "@lucide/svelte/icons/clock";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { displayPreferences } from "$lib/stores/display-preferences";
  import type { TimeRangeValue } from "$lib/stores/scope-url";
  import TimeRangePanel from "$lib/components/time-range/TimeRangePanel.svelte";
  import { rangeLabel } from "$lib/components/time-range/labels";
  import { resolveZone } from "$lib/components/time-range/zone";

  interface Props {
    /** The current range (controlled). */
    value: TimeRangeValue;
    onValueChange: (value: TimeRangeValue) => void;
    presets?: TimeRangePreset[];
    class?: string;
  }

  let {
    value,
    onValueChange,
    presets = [...TIME_RANGE_PRESETS],
    class: className = "",
  }: Props = $props();

  let open = $state(false);
  let zone = $derived(resolveZone($displayPreferences.timeZone));
  let triggerLabel = $derived.by(() => {
    void $displayPreferences;
    return rangeLabel(value);
  });

  function handleSelect(next: TimeRangeValue) {
    onValueChange(next);
    if (next.kind === "preset") open = false;
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button {...props} type="button" variant="outline" size="sm" class="gap-2 {className}">
        <Clock class="h-4 w-4 shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate text-left md:flex-none">{triggerLabel}</span>
        <ChevronDown class="h-4 w-4 shrink-0 opacity-50" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-[320px] max-w-[90vw] p-4" align="end">
    <TimeRangePanel {value} {presets} {zone} onSelect={handleSelect} />
  </Popover.Content>
</Popover.Root>
