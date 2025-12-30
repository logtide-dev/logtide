<script lang="ts">
  import { authAPI, type AuthProvider } from '$lib/api/auth';
  import Button from '$lib/components/ui/button/button.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { KeyRound, Building2, Server } from 'lucide-svelte';

  interface Props {
    onSelectLocal?: () => void;
    onSelectOidc: (provider: AuthProvider) => void;
    onSelectLdap: (provider: AuthProvider) => void;
    onProvidersLoaded?: (hasLocalProvider: boolean) => void;
    actionLabel?: string; // "Sign in" or "Sign up"
  }

  let { onSelectLocal, onSelectOidc, onSelectLdap, onProvidersLoaded, actionLabel = 'Sign in' }: Props = $props();

  let providers = $state<AuthProvider[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Load providers on mount
  $effect(() => {
    loadProviders();
  });

  async function loadProviders() {
    try {
      loading = true;
      error = null;
      const response = await authAPI.getProviders();
      providers = response.providers;

      // Notify parent about available local provider
      const hasLocal = providers.some((p) => p.type === 'local');
      onProvidersLoaded?.(hasLocal);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load auth providers';
      console.error('Failed to load providers:', e);
      onProvidersLoaded?.(false);
    } finally {
      loading = false;
    }
  }

  function handleProviderClick(provider: AuthProvider) {
    if (provider.type === 'local') {
      onSelectLocal?.();
    } else if (provider.type === 'oidc') {
      onSelectOidc(provider);
    } else if (provider.type === 'ldap') {
      onSelectLdap(provider);
    }
  }

  function getProviderIcon(provider: AuthProvider) {
    if (provider.icon === 'mail' || provider.type === 'local') {
      return KeyRound;
    } else if (provider.type === 'ldap') {
      return Server;
    } else {
      return Building2; // Default for OIDC
    }
  }

  // Filter providers: show non-local providers as buttons, local is handled separately
  let externalProviders = $derived(providers.filter((p) => p.type !== 'local'));
  let localProvider = $derived(providers.find((p) => p.type === 'local'));
  let hasExternalProviders = $derived(externalProviders.length > 0);
</script>

{#if loading}
  <div class="flex justify-center py-4">
    <Spinner size="md" />
  </div>
{:else if error}
  <div class="text-sm text-destructive text-center py-2">
    {error}
  </div>
{:else if hasExternalProviders}
  <div class="space-y-3">
    {#each externalProviders as provider}
      <Button
        variant="outline"
        class="w-full gap-2"
        onclick={() => handleProviderClick(provider)}
      >
        <svelte:component this={getProviderIcon(provider)} class="h-4 w-4" />
        {actionLabel} with {provider.name}
      </Button>
    {/each}

    {#if localProvider}
      <div class="relative">
        <div class="absolute inset-0 flex items-center">
          <span class="w-full border-t"></span>
        </div>
        <div class="relative flex justify-center text-xs uppercase">
          <span class="bg-background px-2 text-muted-foreground">Or</span>
        </div>
      </div>
    {/if}
  </div>
{/if}
