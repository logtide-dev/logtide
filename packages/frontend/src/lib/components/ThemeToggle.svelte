<script lang="ts">
  import { themeStore } from '$lib/stores/theme';
  import Button from '$lib/components/ui/button/button.svelte';
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';

  // Use $derived to reactively subscribe to the store
  let theme = $derived($themeStore);

  function toggle() {
    themeStore.toggle();
  }
</script>

<Button
  variant="ghost"
  size="icon"
  onclick={toggle}
  aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
  title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
>
  {#if theme === 'dark'}
    <Sun class="w-5 h-5" />
  {:else}
    <Moon class="w-5 h-5" />
  {/if}
</Button>
