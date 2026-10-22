<script lang="ts">
  import Input from '$lib/components/ui/input/input.svelte';
  import { Popover, PopoverContent } from '$lib/components/ui/popover';
  import { Command, CommandItem, CommandList } from '$lib/components/ui/command';

  interface Props {
    id?: string;
    value: string;
    options: string[];
    loading?: boolean;
    placeholder?: string;
    onChange: (value: string) => void;
  }

  let { id, value, options, loading = false, placeholder, onChange }: Props = $props();

  const MAX_SHOWN = 50;

  let inputEl = $state<HTMLInputElement | null>(null);
  let focused = $state(false);
  let dismissed = $state(false);
  let highlighted = $state('');
  // True between a pointer press inside the list and the click that follows.
  let pressing = false;

  const filtered = $derived.by(() => {
    const needle = value.trim().toLowerCase();
    const list = needle
      ? options.filter((o) => o.toLowerCase().includes(needle))
      : options;
    return list.slice(0, MAX_SHOWN);
  });

  // A value that already equals the only match needs no list.
  const open = $derived(
    focused && !dismissed && filtered.length > 0 && !(filtered.length === 1 && filtered[0] === value)
  );

  $effect(() => {
    // Keep the highlighted option valid as the list changes.
    if (!filtered.includes(highlighted)) highlighted = filtered[0] ?? '';
  });

  function select(option: string) {
    pressing = false;
    onChange(option);
    dismissed = true;
  }

  function onListPress(e: Event) {
    // Keep focus on the input so the list is not unmounted before click fires.
    e.preventDefault();
    pressing = true;
  }

  function onBlur() {
    if (pressing) {
      pressing = false;
      return;
    }
    focused = false;
  }

  function onInput(e: Event) {
    dismissed = false;
    onChange((e.currentTarget as HTMLInputElement).value);
  }

  function move(delta: number) {
    if (filtered.length === 0) return;
    const idx = filtered.indexOf(highlighted);
    const next = (idx + delta + filtered.length) % filtered.length;
    highlighted = filtered[next];
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      dismissed = false;
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      dismissed = false;
      move(-1);
    } else if (e.key === 'Enter') {
      if (open && highlighted) {
        e.preventDefault();
        select(highlighted);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation();
        dismissed = true;
      }
    }
  }
</script>

<div class="relative">
  <Input
    {id}
    bind:ref={inputEl}
    type="text"
    {value}
    {placeholder}
    autocomplete="off"
    role="combobox"
    aria-autocomplete="list"
    aria-expanded={open}
    aria-busy={loading}
    oninput={onInput}
    onkeydown={onKeydown}
    onfocus={() => {
      focused = true;
      dismissed = false;
    }}
    onblur={onBlur}
  />
  <Popover {open}>
    <PopoverContent
      customAnchor={inputEl}
      align="start"
      class="w-[var(--bits-popover-anchor-width)] min-w-48 p-0"
      trapFocus={false}
      onOpenAutoFocus={(e) => e.preventDefault()}
      onCloseAutoFocus={(e) => e.preventDefault()}
      onInteractOutside={(e) => {
        if (e.target === inputEl) e.preventDefault();
      }}
    >
      <div role="presentation" onmousedown={onListPress} onpointerdown={onListPress}>
      <Command shouldFilter={false} bind:value={highlighted}>
        <CommandList class="max-h-56">
          {#each filtered as option (option)}
            <CommandItem value={option} onSelect={() => select(option)} class="cursor-pointer">
              <span class="truncate">{option}</span>
            </CommandItem>
          {/each}
        </CommandList>
      </Command>
      </div>
    </PopoverContent>
  </Popover>
</div>
