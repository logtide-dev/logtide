<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { authAPI } from '$lib/api/auth';
  import Button from '$lib/components/ui/button/button.svelte';
  import FileCheck from '@lucide/svelte/icons/file-check-2';

  // Shown only when the backend advertises terms (auth config termsUrl) AND
  // reports the signed-in user as pending (/me termsAcceptanceRequired). It
  // cannot be dismissed: the only ways out are Accept and Log out.
  let visible = $state(false);
  let termsUrl = $state('');
  let privacyUrl = $state('');
  let termsVersion = $state('');
  let accepting = $state(false);
  let error = $state<string | null>(null);

  async function isPending(token: string): Promise<boolean> {
    const { user } = await authAPI.getMe(token);
    return user?.termsAcceptanceRequired === true;
  }

  onMount(async () => {
    const token = $authStore.token;
    if (!token) return;
    try {
      const config = await authAPI.getAuthConfig();
      if (!config.termsUrl || !config.privacyUrl || !config.termsVersion) return;
      termsUrl = config.termsUrl;
      privacyUrl = config.privacyUrl;
      termsVersion = config.termsVersion;
      visible = await isPending(token);
    } catch {
      visible = false;
    }
  });

  async function accept() {
    accepting = true;
    error = null;
    try {
      const token = $authStore.token;
      await authAPI.acceptTerms(token, termsVersion);
      visible = token ? await isPending(token) : false;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not record your acceptance. Please try again.';
    } finally {
      accepting = false;
    }
  }

  async function logOut() {
    const token = $authStore.token;
    if (token) {
      try {
        await authAPI.logout(token);
      } catch (e) {
        console.error('Logout request failed', e);
      }
    }
    authStore.clearAuth();
    goto('/login');
  }
</script>

{#if visible}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-modal-title"
      class="w-full max-w-md space-y-4 rounded-lg border bg-background p-6 shadow-lg"
    >
      <div class="flex items-center gap-2">
        <FileCheck class="h-5 w-5 text-primary" />
        <h2 id="terms-modal-title" class="text-lg font-semibold">Review our terms</h2>
      </div>
      <p class="text-sm text-muted-foreground">
        To keep using LogTide, please review and accept the
        <a href={termsUrl} target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">Terms of Service</a>
        and the
        <a href={privacyUrl} target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">Privacy Policy</a>.
        Your existing data and ingestion keep working in the meantime.
      </p>
      {#if error}
        <p class="text-sm text-destructive">{error}</p>
      {/if}
      <div class="flex justify-end gap-2">
        <Button variant="outline" disabled={accepting} onclick={logOut}>Log out</Button>
        <Button disabled={accepting} onclick={accept}>{accepting ? 'Saving...' : 'Accept'}</Button>
      </div>
    </div>
  </div>
{/if}
