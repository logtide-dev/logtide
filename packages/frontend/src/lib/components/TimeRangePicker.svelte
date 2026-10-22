<script lang="ts">
  import { TIME_RANGE_PRESETS, type TimeRangePreset } from "@logtide/shared";
  import Button from "$lib/components/ui/button/button.svelte";
  import Label from "$lib/components/ui/label/label.svelte";
  import * as Popover from "$lib/components/ui/popover";
  import Clock from "@lucide/svelte/icons/clock";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { displayPreferences } from "$lib/stores/display-preferences";
  import type { TimeRangeValue } from "$lib/stores/scope-url";
  import TimeRangePanel from "$lib/components/time-range/TimeRangePanel.svelte";
  import { rangeLabel } from "$lib/components/time-range/labels";
  import { fromInputValue, resolveZone, toInputValue } from "$lib/components/time-range/zone";

  export type TimeRangeType = "last_hour" | "last_24h" | "last_7d" | "custom";

  interface TimeRange {
    from: Date;
    to: Date;
  }

  interface Props {
    /**
     * Controlled mode (used by ScopeBar): the current range. When provided the
     * picker renders a popover button; the legacy props below are ignored.
     */
    value?: TimeRangeValue;
    onValueChange?: (value: TimeRangeValue) => void;
    presets?: TimeRangePreset[];
    class?: string;
    /**
     * Legacy mode: initial time range type. Defaults to "last_24h".
     */
    initialType?: TimeRangeType;
    /**
     * Legacy mode: initial custom from time (ISO string or datetime-local format).
     * Only used when initialType is "custom".
     */
    initialCustomFrom?: string;
    /**
     * Legacy mode: initial custom to time (ISO string or datetime-local format).
     * Only used when initialType is "custom".
     */
    initialCustomTo?: string;
    /**
     * Legacy mode: called when the time range changes.
     */
    onchange?: (range: TimeRange) => void;
  }

  let {
    value,
    onValueChange,
    presets = [...TIME_RANGE_PRESETS],
    class: className = "",
    initialType = "last_24h",
    initialCustomFrom = "",
    initialCustomTo = "",
    onchange,
  }: Props = $props();

  // ── Controlled mode ──────────────────────────────────────────────────────
  let open = $state(false);
  let zone = $derived(resolveZone($displayPreferences.timeZone));
  let triggerLabel = $derived.by(() => {
    void $displayPreferences;
    return value ? rangeLabel(value) : "";
  });

  function handleControlledSelect(next: TimeRangeValue) {
    onValueChange?.(next);
    if (next.kind === "preset") open = false;
  }

  // ── Legacy mode ──────────────────────────────────────────────────────────
  // remove legacy mode in Wave D, once logs, traces and audit-log adopt ScopeBar
  const LEGACY_PRESETS: TimeRangePreset[] = ["1h", "24h", "7d"];
  const TYPE_TO_PRESET: Record<Exclude<TimeRangeType, "custom">, TimeRangePreset> = {
    last_hour: "1h",
    last_24h: "24h",
    last_7d: "7d",
  };
  const PRESET_TO_TYPE: Partial<Record<TimeRangePreset, Exclude<TimeRangeType, "custom">>> = {
    "1h": "last_hour",
    "24h": "last_24h",
    "7d": "last_7d",
  };
  // Legacy strings are browser-local datetime-local values.
  const browserZone = resolveZone(null);

  // svelte-ignore state_referenced_locally
  let timeRangeType = $state<TimeRangeType>(initialType);
  // svelte-ignore state_referenced_locally
  let customFromTime = $state(formatDateForInput(initialCustomFrom));
  // svelte-ignore state_referenced_locally
  let customToTime = $state(formatDateForInput(initialCustomTo));

  /**
   * Converts an ISO string to datetime-local format (YYYY-MM-DDTHH:mm)
   */
  function formatDateForInput(isoString: string): string {
    if (!isoString) return "";
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return isoString; // Already in correct format or invalid
      return toInputValue(date, browserZone);
    } catch {
      return "";
    }
  }

  /**
   * Calculates the time range for a given preset type.
   */
  function calculatePresetRange(type: Exclude<TimeRangeType, "custom">): TimeRange {
    const now = new Date();
    let from: Date;

    switch (type) {
      case "last_hour":
        from = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case "last_24h":
        from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case "last_7d":
        from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
    }

    return { from, to: now };
  }

  /**
   * Returns the current time range based on the selected type.
   */
  export function getTimeRange(): TimeRange {
    if (timeRangeType === "custom") {
      const now = new Date();
      const from = customFromTime
        ? new Date(customFromTime)
        : new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const to = customToTime ? new Date(customToTime) : now;
      return { from, to };
    }
    return calculatePresetRange(timeRangeType);
  }

  /**
   * Returns the current time range type.
   */
  export function getType(): TimeRangeType {
    return timeRangeType;
  }

  /**
   * Returns the current custom time values.
   */
  export function getCustomValues(): { from: string; to: string } {
    return { from: customFromTime, to: customToTime };
  }

  /**
   * Programmatically sets the time range (e.g. from URL parameters).
   */
  export function setTimeRange(type: TimeRangeType, customFrom?: string, customTo?: string) {
    timeRangeType = type;
    if (customFrom) customFromTime = formatDateForInput(customFrom);
    if (customTo) customToTime = formatDateForInput(customTo);
  }

  function handleTypeChange(newType: TimeRangeType) {
    const previousType = timeRangeType;
    timeRangeType = newType;

    if (newType === "custom") {
      // When switching TO custom, pre-populate with the current preset's range
      if (previousType !== "custom") {
        const range = calculatePresetRange(previousType);
        customFromTime = formatDateForInput(range.from.toISOString());
        customToTime = formatDateForInput(range.to.toISOString());
      }
      // If previous was also custom, keep existing values (already preserved)
    }
    // When switching FROM custom to a preset, we DON'T clear custom values
    // This allows users to switch back to Custom and see their previous values

    emitChange();
  }

  function emitChange() {
    onchange?.(getTimeRange());
  }

  let legacyValue = $derived.by<TimeRangeValue>(() => {
    if (timeRangeType !== "custom") {
      return { kind: "preset", preset: TYPE_TO_PRESET[timeRangeType] };
    }
    const a = fromInputValue(customFromTime, browserZone);
    const b = fromInputValue(customToTime, browserZone);
    if (a && b) return { kind: "custom", from: a.toISOString(), to: b.toISOString() };
    return { kind: "custom", from: customFromTime, to: customToTime };
  });

  function handleLegacySelect(next: TimeRangeValue) {
    if (next.kind === "preset") {
      const type = PRESET_TO_TYPE[next.preset];
      if (type) handleTypeChange(type);
      return;
    }
    // Editor applied a range: keep the legacy browser-local strings in sync.
    timeRangeType = "custom";
    customFromTime = formatDateForInput(next.from);
    customToTime = formatDateForInput(next.to);
    emitChange();
  }
</script>

{#if value}
  <Popover.Root bind:open>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Button {...props} type="button" variant="outline" size="sm" class="gap-2 {className}">
          <Clock class="h-4 w-4 text-muted-foreground" />
          <span>{triggerLabel}</span>
          <ChevronDown class="h-4 w-4 opacity-50" />
        </Button>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-[320px] max-w-[90vw] p-4" align="end">
      <TimeRangePanel {value} {presets} {zone} onSelect={handleControlledSelect} />
    </Popover.Content>
  </Popover.Root>
{:else}
  <div class="space-y-3 {className}">
    <div class="flex items-center gap-2">
      <Clock class="w-4 h-4 text-muted-foreground" />
      <Label>Time range</Label>
    </div>
    <TimeRangePanel
      value={legacyValue}
      presets={LEGACY_PRESETS}
      zone={browserZone}
      onSelect={handleLegacySelect}
    />
  </div>
{/if}
