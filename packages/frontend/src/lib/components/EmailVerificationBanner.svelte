<script lang="ts">
  import { onMount } from 'svelte';
  import { authStore } from '$lib/stores/auth';
  import { authAPI } from '$lib/api/auth';
  import { shouldShowVerifyBanner } from '$lib/utils/email-verification';
  import Button from '$lib/components/ui/button/button.svelte';
  import MailWarning from '@lucide/svelte/icons/mail-warning';

  let visible = $state(false);
  let sending = $state(false);
  let message = $state<string | null>(null);
  let failed = $state(false);

  onMount(async () => {
    const token = $authStore.token;
    if (!token) return;
    try {
      const config = await authAPI.getAuthConfig();
      if (config.emailVerificationRequired !== true) return;
      const { user } = await authAPI.getMe(token);
      visible = shouldShowVerifyBanner(config.emailVerificationRequired, user?.emailVerified);
    } catch {
      visible = false;
    }
  });

  async function resend() {
    sending = true;
    message = null;
    failed = false;
    try {
      await authAPI.resendVerification($authStore.token);
      message = 'Verification email sent. Check your inbox.';
    } catch (e) {
      failed = true;
      message = e instanceof Error ? e.message : 'Could not send the verification email';
    } finally {
      sending = false;
    }
  }
</script>

{#if visible}
  <div
    role="status"
    class="flex flex-wrap items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm"
  >
    <MailWarning class="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
    <span class="font-medium">Verify your email</span>
    <span class="text-muted-foreground">
      Confirm your address to create projects and API keys. We sent you a link.
    </span>
    {#if message}
      <span class={failed ? 'text-destructive' : 'text-muted-foreground'}>{message}</span>
    {/if}
    <Button variant="outline" size="sm" class="ml-auto" disabled={sending} onclick={resend}>
      {sending ? 'Sending...' : 'Resend email'}
    </Button>
  </div>
{/if}
