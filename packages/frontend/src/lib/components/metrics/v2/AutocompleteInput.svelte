<!--
  Text input with a suggestion list (internal building block of the query builder).

  Props:
    value        text shown when the list is closed (the committed value)
    options      { value, label?, hint? }[] suggestions (filtered client side by what is typed)
    ariaLabel    accessible name of the input
    placeholder  optional
    loading      show "Loading" when there are no options yet
    allowFree    Enter commits the typed text when nothing is highlighted (default true)
    onOpen       called when the list opens (lazy load of suggestions)
    onCommit     called with the chosen option value or the typed text
-->
<script lang="ts">
  export interface AutocompleteOption {
    value: string;
    label?: string;
    hint?: string;
  }

  interface Props {
    value?: string;
    options: AutocompleteOption[];
    ariaLabel: string;
    placeholder?: string;
    loading?: boolean;
    allowFree?: boolean;
    class?: string;
    onOpen?: () => void;
    onCommit: (value: string) => void;
  }

  let {
    value = '',
    options,
    ariaLabel,
    placeholder = '',
    loading = false,
    allowFree = true,
    class: className = '',
    onOpen,
    onCommit,
  }: Props = $props();

  const uid = $props.id();
  const listId = `ac-${uid}`;

  let open = $state(false);
  let query = $state('');
  let active = $state(-1);

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = q ? options.filter((o) => (o.label ?? o.value).toLowerCase().includes(q)) : options;
    return list.slice(0, 200);
  });

  function openList() {
    if (!open) {
      open = true;
      query = '';
      active = -1;
      onOpen?.();
    }
  }

  function close() {
    open = false;
    query = '';
    active = -1;
  }

  function commit(v: string) {
    onCommit(v);
    close();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) openList();
      else active = Math.min(active + 1, filtered.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(active - 1, 0);
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      const hit = active >= 0 ? filtered[active] : undefined;
      if (hit) commit(hit.value);
      else if (allowFree && query.trim() !== '') commit(query.trim());
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close();
    }
  }
</script>

<div class="relative min-w-[140px] {className}">
  <input
    type="text"
    role="combobox"
    aria-label={ariaLabel}
    aria-expanded={open}
    aria-controls={listId}
    aria-autocomplete="list"
    autocomplete="off"
    {placeholder}
    class="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    value={open ? query : value}
    oninput={(e) => {
      query = e.currentTarget.value;
      active = -1;
      open = true;
    }}
    onfocus={openList}
    onclick={openList}
    onblur={close}
    onkeydown={onKeydown}
  />
  {#if open}
    <ul
      id={listId}
      role="listbox"
      aria-label="{ariaLabel} suggestions"
      class="absolute z-30 mt-1 max-h-60 w-full min-w-[220px] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {#each filtered as option, i (option.value)}
        <li role="presentation">
          <button
            type="button"
            role="option"
            aria-selected={option.value === value}
            class="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted {i === active ? 'bg-muted' : ''}"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => commit(option.value)}
          >
            <span class="truncate">{option.label ?? option.value}</span>
            {#if option.hint}<span class="shrink-0 text-xs text-muted-foreground">{option.hint}</span>{/if}
          </button>
        </li>
      {:else}
        <li class="px-2 py-1.5 text-sm text-muted-foreground">
          {loading ? 'Loading' : allowFree && query.trim() ? 'Press Enter to use this text' : 'No suggestions'}
        </li>
      {/each}
    </ul>
  {/if}
</div>
