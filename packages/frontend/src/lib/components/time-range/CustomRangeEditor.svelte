<script lang="ts">
  import { untrack } from "svelte";
  import Input from "$lib/components/ui/input/input.svelte";
  import Label from "$lib/components/ui/label/label.svelte";
  import { RangeCalendar } from "$lib/components/ui/range-calendar";
  import { CalendarDate, type DateValue } from "@internationalized/date";
  import type { DateRange } from "bits-ui";
  import { fromInputValue, toInputValue } from "./zone.js";

  interface Props {
    from: Date;
    to: Date;
    /** IANA zone the wall clock is shown and parsed in. */
    zone: string;
    onApply: (range: { from: Date; to: Date }) => void;
  }

  let { from, to, zone, onApply }: Props = $props();

  const datePart = (s: string) => (s ? s.slice(0, 10) : "");
  const timePart = (s: string) => (s && s.length >= 16 ? s.slice(11, 16) : "00:00");
  const pad = (n: number) => String(n).padStart(2, "0");

  function toCalendarDate(s: string): DateValue | undefined {
    const [y, m, day] = datePart(s).split("-").map(Number);
    if (!y || !m || !day) return undefined;
    return new CalendarDate(y, m, day);
  }

  function buildCalendar(a: string, b: string): DateRange {
    return { start: toCalendarDate(a), end: toCalendarDate(b) };
  }

  function dateStr(d: DateValue): string {
    return `${String(d.year).padStart(4, "0")}-${pad(d.month)}-${pad(d.day)}`;
  }

  // svelte-ignore state_referenced_locally
  let fromText = $state(toInputValue(from, zone));
  // svelte-ignore state_referenced_locally
  let toText = $state(toInputValue(to, zone));
  let error = $state("");
  // svelte-ignore state_referenced_locally
  let calendarValue = $state<DateRange>(buildCalendar(fromText, toText));

  // Follow the props (parent applied a new range, or the zone changed).
  $effect(() => {
    const nextFrom = toInputValue(from, zone);
    const nextTo = toInputValue(to, zone);
    untrack(() => {
      fromText = nextFrom;
      toText = nextTo;
      calendarValue = buildCalendar(nextFrom, nextTo);
      error = "";
    });
  });

  function commit() {
    const a = fromInputValue(fromText, zone);
    const b = fromInputValue(toText, zone);
    if (!a || !b) {
      error = "Enter a valid date and time";
      return;
    }
    if (a.getTime() >= b.getTime()) {
      error = "End must be after start";
      return;
    }
    error = "";
    onApply({ from: a, to: b });
  }

  function handleInput(which: "from" | "to", value: string) {
    if (which === "from") fromText = value;
    else toText = value;
    calendarValue = buildCalendar(fromText, toText);
    commit();
  }

  function handleCalendar(range: DateRange | undefined) {
    if (!range) return;
    calendarValue = range;
    if (!range.start || !range.end) return;
    fromText = `${dateStr(range.start)}T${timePart(fromText)}`;
    toText = `${dateStr(range.end)}T${timePart(toText)}`;
    commit();
  }
</script>

<div class="space-y-3">
  <div class="rounded-md border">
    <RangeCalendar numberOfMonths={1} value={calendarValue} onValueChange={handleCalendar} />
  </div>
  <div class="grid grid-cols-2 gap-3">
    <div class="space-y-1.5">
      <Label for="scope-range-from">From</Label>
      <Input
        id="scope-range-from"
        type="datetime-local"
        value={fromText}
        onchange={(e) => handleInput("from", (e.currentTarget as HTMLInputElement).value)}
      />
    </div>
    <div class="space-y-1.5">
      <Label for="scope-range-to">To</Label>
      <Input
        id="scope-range-to"
        type="datetime-local"
        value={toText}
        onchange={(e) => handleInput("to", (e.currentTarget as HTMLInputElement).value)}
      />
    </div>
  </div>
  {#if error}
    <p role="alert" class="text-sm text-destructive">{error}</p>
  {/if}
</div>
