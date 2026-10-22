<script lang="ts">
  import * as Popover from "$lib/components/ui/popover";
  import Button from "$lib/components/ui/button/button.svelte";
  import CircleHelp from "@lucide/svelte/icons/circle-help";

  interface Props {
    disabled?: boolean;
    class?: string;
  }

  let { disabled = false, class: className = '' }: Props = $props();

  const ROWS: { example: string; meaning: string }[] = [
    { example: "timeout", meaning: "Message contains the word" },
    { example: '"connection refused"', meaning: "Message contains the exact phrase" },
    { example: "-word", meaning: "Message does not contain the word" },
    { example: '-"phrase"', meaning: "Message does not contain the phrase" },
    { example: "timeout OR refused", meaning: "Message contains either word" },
    { example: "service:api", meaning: "Field equals the value" },
    { example: "-service:api", meaning: "Field is not the value" },
    { example: "level:(error OR critical)", meaning: "Field is one of the values" },
    { example: "user.id:*", meaning: "Field exists" },
    { example: "-user.id:*", meaning: "Field does not exist" },
    { example: "path:*admin*", meaning: "Field contains the text" },
  ];
</script>

<Popover.Root>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost"
        size="icon"
        class="h-9 w-9 shrink-0 {className}"
        aria-label="Query syntax help"
        title="Query syntax help"
        {disabled}
      >
        <CircleHelp class="w-4 h-4" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-[360px] p-3" align="end">
    <div class="space-y-3 text-sm">
      <div>
        <p class="font-medium">Query syntax</p>
        <p class="text-xs text-muted-foreground">Clauses separated by spaces must all match.</p>
      </div>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        {#each ROWS as row (row.example)}
          <dt><code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{row.example}</code></dt>
          <dd class="text-xs text-muted-foreground self-center">{row.meaning}</dd>
        {/each}
      </dl>
      <p class="text-xs text-muted-foreground">
        Built-in keys: level, service, host, trace, session, span. Any other key is a metadata key; dot paths reach nested values.
      </p>
    </div>
  </Popover.Content>
</Popover.Root>
