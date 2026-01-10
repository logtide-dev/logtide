<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import Spinner from '$lib/components/Spinner.svelte';

  let isAuthenticated = $state(false);
  let checkingAuth = $state(true);

  onMount(() => {
    const unsubscribe = authStore.subscribe((state) => {
      isAuthenticated = !!state.token;
      checkingAuth = false;

      // Redirect based on auth state
      if (isAuthenticated) {
        goto('/dashboard');
      } else {
        goto('/login');
      }
    });
    return unsubscribe;
  });
</script>

<svelte:head>
  <title>LogWard</title>
</svelte:head>

{#if checkingAuth}
  <div class="min-h-screen flex items-center justify-center bg-background">
    <Spinner size="lg" />
  </div>
{/if}
