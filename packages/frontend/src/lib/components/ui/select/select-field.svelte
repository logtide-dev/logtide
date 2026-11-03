<!--
  Single-choice dropdown on the design system Select, with the API of a plain
  <select>: a string value (bindable), a list of options, an id for <label for>.
  The empty string is a valid option value ("All services", "None"), mapped to
  an internal sentinel because the Select primitive treats "" as no selection.
-->
<script lang="ts" module>
  export interface SelectFieldOption {
    value: string;
    label: string;
    disabled?: boolean;
    title?: string;
  }
</script>

<script lang="ts">
  import { Select as SelectPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';
  import SelectTrigger from './select-trigger.svelte';
  import SelectContent from './select-content.svelte';
  import SelectItem from './select-item.svelte';

  const EMPTY = '__select_field_empty__';

  interface Props {
    value?: string;
    options: SelectFieldOption[];
    onValueChange?: (value: string) => void;
    id?: string;
    placeholder?: string;
    disabled?: boolean;
    size?: 'default' | 'sm';
    class?: string;
    contentClass?: string;
    title?: string;
    'aria-label'?: string;
    'aria-describedby'?: string;
    'data-testid'?: string;
  }

  let {
    value = $bindable(''),
    options,
    onValueChange,
    id,
    placeholder,
    disabled = false,
    size = 'default',
    class: className,
    contentClass,
    title,
    'aria-label': ariaLabel,
    'aria-describedby': ariaDescribedby,
    'data-testid': testId,
  }: Props = $props();

  const toInner = (v: string) => (v === '' ? EMPTY : v);
  const selected = $derived(options.find((o) => o.value === value));
</script>

<SelectPrimitive.Root
  type="single"
  value={selected ? toInner(value) : undefined}
  {disabled}
  onValueChange={(v) => {
    if (v === undefined) return;
    const next = v === EMPTY ? '' : v;
    if (next === value) return;
    value = next;
    onValueChange?.(next);
  }}
>
  <SelectTrigger
    {id}
    {title}
    aria-label={ariaLabel}
    aria-describedby={ariaDescribedby}
    data-testid={testId}
    class={cn(size === 'sm' ? 'h-8 px-2 text-xs' : 'h-9', 'gap-2', className)}
  >
    <span class={cn('truncate', !selected && 'text-muted-foreground')}>
      {selected ? selected.label : (placeholder ?? 'Select...')}
    </span>
  </SelectTrigger>
  <SelectContent class={contentClass}>
    {#each options as option (option.value)}
      <SelectItem
        value={toInner(option.value)}
        label={option.label}
        disabled={option.disabled}
        title={option.title}
        class={size === 'sm' ? 'text-xs' : undefined}
      />
    {/each}
  </SelectContent>
</SelectPrimitive.Root>
