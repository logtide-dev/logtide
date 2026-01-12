<script lang="ts">
  import Button from "$lib/components/ui/button/button.svelte";
  import Input from "$lib/components/ui/input/input.svelte";
  import Label from "$lib/components/ui/label/label.svelte";
  import Clock from "@lucide/svelte/icons/clock";

  export type TimeRangeType = "last_hour" | "last_24h" | "last_7d" | "custom";

  interface TimeRange {
    from: Date;
    to: Date;
  }

  interface Props {
    /**
     * Initial time range type. Defaults to "last_24h".
     */
    initialType?: TimeRangeType;
    /**
     * Initial custom from time (ISO string or datetime-local format).
     * Only used when initialType is "custom".
     */
    initialCustomFrom?: string;
    /**
     * Initial custom to time (ISO string or datetime-local format).
     * Only used when initialType is "custom".
     */
    initialCustomTo?: string;
    /**
     * Called when the time range changes.
     */
    onchange?: (range: TimeRange) => void;
  }

  let {
    initialType = "last_24h",
    initialCustomFrom = "",
    initialCustomTo = "",
    onchange,
  }: Props = $props();

  let timeRangeType = $state<TimeRangeType>(initialType);
  let customFromTime = $state(formatDateForInput(initialCustomFrom));
  let customToTime = $state(formatDateForInput(initialCustomTo));

  /**
   * Converts an ISO string to datetime-local format (YYYY-MM-DDTHH:mm)
   */
  function formatDateForInput(isoString: string): string {
    if (!isoString) return "";
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return isoString; // Already in correct format or invalid
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      return `${year}-${month}-${day}T${hours}:${minutes}`;
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

  function handleCustomTimeChange() {
    emitChange();
  }

  function emitChange() {
    onchange?.(getTimeRange());
  }
</script>

<div class="space-y-3">
  <div class="flex items-center gap-2">
    <Clock class="w-4 h-4 text-muted-foreground" />
    <Label>Time Range</Label>
  </div>
  <div class="flex flex-wrap gap-2">
    <Button
      variant={timeRangeType === "last_hour" ? "default" : "outline"}
      size="sm"
      onclick={() => handleTypeChange("last_hour")}
    >
      Last Hour
    </Button>
    <Button
      variant={timeRangeType === "last_24h" ? "default" : "outline"}
      size="sm"
      onclick={() => handleTypeChange("last_24h")}
    >
      Last 24 Hours
    </Button>
    <Button
      variant={timeRangeType === "last_7d" ? "default" : "outline"}
      size="sm"
      onclick={() => handleTypeChange("last_7d")}
    >
      Last 7 Days
    </Button>
    <Button
      variant={timeRangeType === "custom" ? "default" : "outline"}
      size="sm"
      onclick={() => handleTypeChange("custom")}
    >
      Custom
    </Button>
  </div>

  {#if timeRangeType === "custom"}
    <div class="grid gap-3 md:grid-cols-2 pt-2">
      <div class="space-y-2">
        <Label for="time-range-from">From</Label>
        <Input
          id="time-range-from"
          type="datetime-local"
          bind:value={customFromTime}
          onchange={handleCustomTimeChange}
        />
      </div>
      <div class="space-y-2">
        <Label for="time-range-to">To</Label>
        <Input
          id="time-range-to"
          type="datetime-local"
          bind:value={customToTime}
          onchange={handleCustomTimeChange}
        />
      </div>
    </div>
  {/if}
</div>
