<script lang="ts">
  import { RangeCalendar as RangeCalendarPrimitive } from "bits-ui";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { cn } from "$lib/utils.js";
  import { buttonVariants } from "$lib/components/ui/button";

  let {
    value = $bindable(),
    placeholder = $bindable(),
    class: className,
    ...restProps
  }: RangeCalendarPrimitive.RootProps = $props();
</script>

<RangeCalendarPrimitive.Root
  bind:value
  bind:placeholder
  numberOfMonths={2}
  weekdayFormat="short"
  class={cn("p-3", className)}
  {...restProps}
>
  {#snippet children({ months, weekdays })}
    <RangeCalendarPrimitive.Header class="relative flex items-center justify-between pb-3">
      <RangeCalendarPrimitive.PrevButton
        class={cn(buttonVariants({ variant: "outline", size: "icon" }), "size-7")}
      >
        <ChevronLeft class="size-4" />
      </RangeCalendarPrimitive.PrevButton>
      <RangeCalendarPrimitive.Heading class="text-sm font-medium" />
      <RangeCalendarPrimitive.NextButton
        class={cn(buttonVariants({ variant: "outline", size: "icon" }), "size-7")}
      >
        <ChevronRight class="size-4" />
      </RangeCalendarPrimitive.NextButton>
    </RangeCalendarPrimitive.Header>

    <div class="flex flex-col gap-4 sm:flex-row">
      {#each months as month (month.value)}
        <RangeCalendarPrimitive.Grid class="w-full border-collapse select-none space-y-1">
          <RangeCalendarPrimitive.GridHead>
            <RangeCalendarPrimitive.GridRow class="flex">
              {#each weekdays as weekday (weekday)}
                <RangeCalendarPrimitive.HeadCell
                  class="w-9 rounded-md text-[0.8rem] font-normal text-muted-foreground"
                >
                  {weekday.slice(0, 2)}
                </RangeCalendarPrimitive.HeadCell>
              {/each}
            </RangeCalendarPrimitive.GridRow>
          </RangeCalendarPrimitive.GridHead>
          <RangeCalendarPrimitive.GridBody>
            {#each month.weeks as weekDates (weekDates)}
              <RangeCalendarPrimitive.GridRow class="mt-2 flex w-full">
                {#each weekDates as date (date)}
                  <RangeCalendarPrimitive.Cell
                    {date}
                    month={month.value}
                    class="relative size-9 p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([data-selected])]:bg-accent [&:has([data-selected][data-range-end])]:rounded-r-md [&:has([data-selected][data-range-start])]:rounded-l-md [&:has([data-selected][data-outside-month])]:bg-accent/50 first:[&:has([data-selected])]:rounded-l-md last:[&:has([data-selected])]:rounded-r-md"
                  >
                    <RangeCalendarPrimitive.Day
                      class={cn(
                        buttonVariants({ variant: "ghost" }),
                        "size-9 p-0 font-normal",
                        "data-[selected]:bg-primary data-[selected]:text-primary-foreground data-[selected]:opacity-100 data-[selected]:hover:bg-primary data-[selected]:hover:text-primary-foreground",
                        "data-[today]:bg-accent data-[today]:text-accent-foreground",
                        "data-[outside-month]:text-muted-foreground data-[outside-month]:opacity-50 data-[outside-month]:pointer-events-none",
                        "data-[disabled]:text-muted-foreground data-[disabled]:opacity-50 data-[disabled]:pointer-events-none",
                        "data-[unavailable]:text-muted-foreground data-[unavailable]:line-through"
                      )}
                    />
                  </RangeCalendarPrimitive.Cell>
                {/each}
              </RangeCalendarPrimitive.GridRow>
            {/each}
          </RangeCalendarPrimitive.GridBody>
        </RangeCalendarPrimitive.Grid>
      {/each}
    </div>
  {/snippet}
</RangeCalendarPrimitive.Root>
