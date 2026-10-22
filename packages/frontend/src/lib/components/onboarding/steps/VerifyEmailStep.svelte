<script lang="ts">
  import { onMount } from 'svelte';
  import { authStore } from '$lib/stores/auth';
  import { authAPI } from '$lib/api/auth';
  import Button from '$lib/components/ui/button/button.svelte';
  import MailCheck from '@lucide/svelte/icons/mail-check';

  interface Props {
    onVerified: () => void;
    pollMs?: number;
    cooldownMs?: number;
  }

  let { onVerified, pollMs = 5000, cooldownMs = 60000 }: Props = $props();

  const email = $derived($authStore.user?.email ?? '');

  let sending = $state(false);
  let cooldownUntil = $state(0);
  let now = $state(Date.now());
  let message = $state<string | null>(null);
  let failed = $state(false);

  const coolingDown = $derived(now < cooldownUntil);
  const secondsLeft = $derived(Math.max(0, Math.ceil((cooldownUntil - now) / 1000)));

  onMount(() => {
    let stopped = false;
    let checking = false;

    async function check() {
      if (stopped || checking) return;
      checking = true;
      try {
        const { user } = await authAPI.getMe($authStore.token);
        if (!stopped && user?.emailVerified === true) {
          stopped = true;
          clearInterval(poll);
          onVerified();
        }
      } catch {
        // transient failure: keep polling
      } finally {
        checking = false;
      }
    }

    const poll = setInterval(check, pollMs);
    const tick = setInterval(() => (now = Date.now()), 1000);

    return () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  });

  async function resend() {
    if (sending || coolingDown) return;
    sending = true;
    message = null;
    failed = false;
    try {
      await authAPI.resendVerification($authStore.token);
      message = 'If the address is unverified, a new email is on its way. Check your inbox.';
    } catch (e) {
      failed = true;
      message = e instanceof Error ? e.message : 'Could not send the verification email';
    } finally {
      sending = false;
      now = Date.now();
      cooldownUntil = now + cooldownMs;
    }
  }
</script>

<div class="space-y-6 text-center">
  <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
    <MailCheck class="h-8 w-8 text-primary-text" aria-hidden="true" />
  </div>
  <div class="space-y-2">
    <h2 class="text-2xl font-bold">Verify your email</h2>
    <p class="mx-auto max-w-md text-muted-foreground">
      We sent a link to <span class="font-medium text-foreground">{email}</span>. Open it to
      continue. This page moves on by itself once the address is confirmed.
    </p>
  </div>
  <div class="flex flex-col items-center gap-2">
    <Button variant="outline" disabled={sending || coolingDown} onclick={resend}>
      {#if coolingDown}
        Resend email ({secondsLeft} s)
      {:else}
        Resend email
      {/if}
    </Button>
    {#if message}
      <p class="text-sm {failed ? 'text-destructive-text' : 'text-muted-foreground'}" role="status">
        {message}
      </p>
    {/if}
  </div>
</div>
