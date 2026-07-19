<script lang="ts">
  // Shared segmented time-range selector, so preset time-range controls look the
  // same across pages (previously each page hand-rolled its own button group /
  // dropdown with different styling).
  interface Option {
    value: string;
    label: string;
  }

  let {
    options,
    value,
    onChange,
    class: className = '',
  }: {
    options: Option[];
    value: string;
    onChange: (value: string) => void;
    class?: string;
  } = $props();
</script>

<div class="inline-flex items-center rounded-md border bg-muted p-0.5 {className}">
  {#each options as opt (opt.value)}
    <button
      type="button"
      onclick={() => onChange(opt.value)}
      aria-pressed={value === opt.value}
      class="h-7 rounded px-2.5 text-xs font-medium transition-colors {value === opt.value
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'}"
    >
      {opt.label}
    </button>
  {/each}
</div>
