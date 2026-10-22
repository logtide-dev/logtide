<script lang="ts">
  import { tick } from "svelte";
  import { parseLogQuery } from "@logtide/shared";
  import Button from "$lib/components/ui/button/button.svelte";
  import SearchIcon from "@lucide/svelte/icons/search";
  import QuerySyntaxHelp from "./QuerySyntaxHelp.svelte";
  import { errorRange, tokenSegments, type HighlightKind, type TokenSegment } from "./query-highlight";
  import { applySuggestion, getCompletionContext, suggest } from "./query-autocomplete";

  interface Props {
    value: string;
    /** Discovered metadata keys for field suggestions. */
    fields: string[];
    /** Known values of a grammar key (facet values) for value suggestions. */
    valuesFor: (key: string) => string[];
    /** A 400 from the server for the last submitted query; shown until the next edit. */
    serverError?: { message: string; position: number } | null;
    disabled?: boolean;
    onSubmit: (q: string) => void;
    onEdit?: () => void;
  }

  let {
    value = $bindable(""),
    fields,
    valuesFor,
    serverError = null,
    disabled = false,
    onSubmit,
    onEdit,
  }: Props = $props();

  const LISTBOX_ID = "log-query-suggestions";
  const ERROR_ID = "log-query-error";

  // Same text colours in both themes through the semantic tokens.
  const KIND_CLASS: Record<HighlightKind, string> = {
    field: "text-primary-text",
    word: "text-foreground",
    phrase: "text-success-text",
    operator: "text-info-text",
    negation: "text-warning-text",
    error: "text-destructive-text",
    plain: "text-foreground",
  };

  interface Segment extends TokenSegment {
    error: boolean;
  }

  let inputEl = $state<HTMLInputElement | null>(null);
  let overlayEl = $state<HTMLDivElement | null>(null);
  let caret = $state(0);
  let open = $state(false);
  let activeIndex = $state(0);
  let refused = $state(false);
  let serverDismissed = $state(false);

  const parsed = $derived(parseLogQuery(value));
  const clientError = $derived(parsed.ok === false ? parsed.error : null);
  const shownError = $derived(clientError ?? (serverError && !serverDismissed ? serverError : null));
  // A refused Enter and a server rejection both answer a submit: announce them at once.
  const assertive = $derived(refused || (clientError === null && shownError !== null));
  const underline = $derived(shownError ? errorRange(value, parsed.tokens, shownError.position) : null);
  const segments = $derived(splitAtRange(tokenSegments(value, parsed.tokens), underline));
  const context = $derived(getCompletionContext(value, caret));
  const suggestions = $derived(open && !disabled ? suggest(context, { fields, valuesFor }) : []);
  const listOpen = $derived(suggestions.length > 0);

  // A new server error is shown again even after earlier edits.
  $effect(() => {
    serverError;
    serverDismissed = false;
  });

  $effect(() => {
    suggestions;
    activeIndex = 0;
  });

  /** Splits segments at the underline range so only the offending characters get the wavy line. */
  function splitAtRange(list: TokenSegment[], range: { start: number; end: number } | null): Segment[] {
    if (!range || range.end <= range.start) return list.map((s) => ({ ...s, error: false }));
    const out: Segment[] = [];
    for (const seg of list) {
      const segEnd = seg.start + seg.text.length;
      const from = Math.max(seg.start, range.start);
      const to = Math.min(segEnd, range.end);
      if (to <= from) {
        out.push({ ...seg, error: false });
        continue;
      }
      if (from > seg.start) out.push({ ...seg, text: seg.text.slice(0, from - seg.start), error: false });
      out.push({ text: seg.text.slice(from - seg.start, to - seg.start), kind: seg.kind, start: from, error: true });
      if (to < segEnd) out.push({ text: seg.text.slice(to - seg.start), kind: seg.kind, start: to, error: false });
    }
    return out;
  }

  function optionId(index: number): string {
    return `${LISTBOX_ID}-${index}`;
  }

  function syncScroll() {
    if (overlayEl && inputEl) overlayEl.scrollLeft = inputEl.scrollLeft;
  }

  function updateCaret() {
    caret = inputEl?.selectionStart ?? value.length;
    syncScroll();
  }

  function edited() {
    refused = false;
    serverDismissed = true;
    onEdit?.();
  }

  function handleInput(event: Event) {
    const el = event.currentTarget as HTMLInputElement;
    value = el.value;
    caret = el.selectionStart ?? value.length;
    open = true;
    edited();
    syncScroll();
  }

  function submit() {
    if (disabled) return;
    if (!parsed.ok) {
      refused = true;
      return;
    }
    open = false;
    onSubmit(value);
  }

  /** Accepting would only re-insert what is already typed: Enter then runs the search. */
  function acceptChangesNothing(index: number): boolean {
    const s = suggestions[index];
    if (!s || context.kind === "none") return true;
    return value.slice(context.start, context.end) === s.insert;
  }

  async function accept(index: number) {
    const s = suggestions[index];
    if (!s || context.kind === "none") return;
    const next = applySuggestion(value, context, s);
    value = next.value;
    caret = next.caret;
    edited();
    await tick();
    if (inputEl) {
      inputEl.value = next.value;
      inputEl.setSelectionRange(next.caret, next.caret);
    }
    syncScroll();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (disabled) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!listOpen) {
          open = true;
          updateCaret();
          return;
        }
        activeIndex = (activeIndex + 1) % suggestions.length;
        return;
      case "ArrowUp":
        if (!listOpen) return;
        event.preventDefault();
        activeIndex = (activeIndex - 1 + suggestions.length) % suggestions.length;
        return;
      case "Tab":
        if (!listOpen) return;
        event.preventDefault();
        void accept(activeIndex);
        return;
      case "Escape":
        if (!listOpen) return;
        event.preventDefault();
        event.stopPropagation();
        open = false;
        return;
      case "Enter":
        event.preventDefault();
        if (listOpen && !acceptChangesNothing(activeIndex)) {
          void accept(activeIndex);
          return;
        }
        submit();
        return;
    }
  }

  function handleKeyup(event: KeyboardEvent) {
    if (["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(event.key)) return;
    updateCaret();
  }
</script>

<div class="w-full">
  <div class="flex items-center gap-1">
    <div class="relative min-w-0 flex-1 rounded-md bg-background">
      <div
        bind:this={overlayEl}
        data-testid="log-query-overlay"
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre rounded-md border border-transparent px-3 font-mono text-sm"
      >
        <span
          >{#each segments as seg}<span
              data-kind={seg.kind}
              class="{KIND_CLASS[seg.kind]} {seg.error
                ? 'underline decoration-wavy decoration-destructive underline-offset-4'
                : ''}">{seg.text}</span
            >{/each}</span
        >
      </div>
      <input
        bind:this={inputEl}
        id="search"
        type="text"
        role="combobox"
        aria-label="Log query"
        aria-autocomplete="list"
        aria-expanded={listOpen}
        aria-controls={LISTBOX_ID}
        aria-activedescendant={listOpen ? optionId(activeIndex) : undefined}
        aria-invalid={shownError ? "true" : undefined}
        aria-describedby={shownError ? ERROR_ID : undefined}
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="Search logs, e.g. level:error service:api timeout"
        {value}
        {disabled}
        class="relative h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono text-sm text-transparent caret-foreground selection:bg-primary/25 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        oninput={handleInput}
        onkeydown={handleKeydown}
        onkeyup={handleKeyup}
        onclick={updateCaret}
        onscroll={syncScroll}
        onblur={() => (open = false)}
      />
      {#if listOpen}
        <ul
          id={LISTBOX_ID}
          role="listbox"
          aria-label="Query suggestions"
          class="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {#each suggestions as s, i (s.kind + ":" + s.label)}
            <li
              id={optionId(i)}
              role="option"
              tabindex="-1"
              aria-selected={i === activeIndex}
              class="cursor-pointer truncate rounded-sm px-2 py-1 font-mono text-xs {i === activeIndex
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-muted'}"
              onmousedown={(e) => {
                e.preventDefault();
                void accept(i);
              }}
            >
              {s.label}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    <QuerySyntaxHelp {disabled} />
    <Button
      size="icon"
      class="h-9 w-9 shrink-0"
      aria-label="Run search"
      title="Run search"
      {disabled}
      onclick={submit}
    >
      <SearchIcon class="w-4 h-4" />
    </Button>
  </div>
  <div aria-live="polite">
    {#if shownError}
      <p id={ERROR_ID} role={assertive ? "alert" : undefined} class="mt-1 text-xs text-destructive-text">
        {shownError.message} (position {shownError.position + 1})
      </p>
    {/if}
  </div>
</div>
