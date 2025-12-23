<script lang="ts">
  import { authAPI, type AuthProvider, type AuthResponse } from '$lib/api/auth';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import Spinner from '$lib/components/Spinner.svelte';
  import { ArrowLeft } from 'lucide-svelte';

  interface Props {
    provider: AuthProvider;
    onSuccess: (response: AuthResponse & { isNewUser: boolean }) => void;
    onBack: () => void;
  }

  let { provider, onSuccess, onBack }: Props = $props();

  let username = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);
  let usernameError = $state('');
  let passwordError = $state('');

  function validateForm(): boolean {
    usernameError = '';
    passwordError = '';
    let isValid = true;

    if (!username.trim()) {
      usernameError = 'Username is required';
      isValid = false;
    }

    if (!password) {
      passwordError = 'Password is required';
      isValid = false;
    }

    return isValid;
  }

  async function handleSubmit() {
    if (!validateForm()) {
      error = 'Please fix the errors below';
      return;
    }

    loading = true;
    error = '';

    try {
      const response = await authAPI.loginWithLdap(provider.slug, username.trim(), password);
      onSuccess(response);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Login failed';
    } finally {
      loading = false;
    }
  }
</script>

<div class="space-y-4">
  <button
    type="button"
    class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    onclick={onBack}
  >
    <ArrowLeft class="h-4 w-4" />
    Back to login options
  </button>

  <div class="text-center">
    <h3 class="font-semibold">Sign in with {provider.name}</h3>
    <p class="text-sm text-muted-foreground">Enter your directory credentials</p>
  </div>

  <form onsubmit={(e: SubmitEvent) => { e.preventDefault(); handleSubmit(); }}>
    <div class="space-y-4">
      {#if error}
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      {/if}

      <div class="space-y-2">
        <Label for="username">Username</Label>
        <Input
          id="username"
          type="text"
          placeholder="your.username"
          bind:value={username}
          disabled={loading}
          required
          class={usernameError ? 'border-destructive' : ''}
        />
        {#if usernameError}
          <p class="text-sm text-destructive">{usernameError}</p>
        {/if}
      </div>

      <div class="space-y-2">
        <Label for="password">Password</Label>
        <Input
          id="password"
          type="password"
          placeholder="••••••••"
          bind:value={password}
          disabled={loading}
          required
          class={passwordError ? 'border-destructive' : ''}
        />
        {#if passwordError}
          <p class="text-sm text-destructive">{passwordError}</p>
        {/if}
      </div>

      <Button type="submit" class="w-full gap-2" disabled={loading}>
        {#if loading}
          <Spinner size="sm" />
          Signing in...
        {:else}
          Sign in
        {/if}
      </Button>
    </div>
  </form>
</div>
