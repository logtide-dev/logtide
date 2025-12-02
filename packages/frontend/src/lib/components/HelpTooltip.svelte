<script lang="ts">
  import * as Tooltip from '$lib/components/ui/tooltip';
  import HelpCircle from '@lucide/svelte/icons/help-circle';

  interface Props {
    /** Help text to display */
    text: string;
    /** Size of the help icon */
    size?: 'sm' | 'md';
  }

  let {
    text,
    size = 'sm'
  }: Props = $props();

  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
</script>

<Tooltip.Root openDelay={200}>
  <Tooltip.Trigger>
    {#snippet child({ props })}
      <span
        {...props}
        role="button"
        tabindex="0"
        class="inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-muted p-0.5 cursor-help"
        aria-label="Help"
      >
        <HelpCircle class={iconSize} />
      </span>
    {/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content class="max-w-xs">
    <p class="text-sm">{text}</p>
  </Tooltip.Content>
</Tooltip.Root>
