<script lang="ts">
  import { themeStore, type ThemePreference } from '$lib/stores/theme';
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
  } from '$lib/components/ui/dropdown-menu';
  import Button from '$lib/components/ui/button/button.svelte';
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';
  import Monitor from '@lucide/svelte/icons/monitor';
  import Check from '@lucide/svelte/icons/check';

  const preference = themeStore.preference;
  let resolved = $derived($themeStore);
  let current = $derived($preference);

  const options: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];
</script>

<DropdownMenu>
  <DropdownMenuTrigger>
    <Button variant="ghost" size="icon" aria-label="Change theme" title="Change theme">
      {#if current === 'system'}
        <Monitor class="w-5 h-5" />
      {:else if resolved === 'dark'}
        <Moon class="w-5 h-5" />
      {:else}
        <Sun class="w-5 h-5" />
      {/if}
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    {#each options as opt}
      <DropdownMenuItem onclick={() => themeStore.setPreference(opt.value)}>
        <opt.icon class="w-4 h-4 mr-2" />
        <span class="flex-1">{opt.label}</span>
        {#if current === opt.value}
          <Check class="w-4 h-4 ml-2 text-primary" />
        {/if}
      </DropdownMenuItem>
    {/each}
  </DropdownMenuContent>
</DropdownMenu>
