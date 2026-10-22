<script lang="ts">
  import { subscribeToStatusPage } from '$lib/api/status-page';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import { readableForeground } from '../contrast';

  interface Props {
    orgSlug: string;
    projectSlug: string;
    accentColor?: string | null;
  }

  let { orgSlug, projectSlug, accentColor = null }: Props = $props();

  let email = $state('');
  let submitting = $state(false);
  let done = $state(false);
  let error = $state<string | null>(null);

  const foreground = $derived(accentColor ? readableForeground(accentColor) : null);

  async function submit(e: Event) {
    e.preventDefault();
    if (submitting) return;
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      error = 'Enter a valid email address';
      return;
    }
    error = null;
    submitting = true;
    try {
      await subscribeToStatusPage(orgSlug, projectSlug, value);
      done = true;
    } catch (err) {
      const status = (err as { status?: number }).status;
      error =
        status === 429
          ? 'Too many attempts. Try again in a minute.'
          : err instanceof Error
            ? err.message
            : 'Could not subscribe. Try again.';
    } finally {
      submitting = false;
    }
  }
</script>

<section id="subscribe" class="rounded-lg border bg-card p-4" aria-labelledby="subscribe-heading">
  <h2 id="subscribe-heading" class="text-sm font-semibold">Subscribe to updates</h2>
  <p class="mt-0.5 text-xs text-muted-foreground">
    Get an email when an incident is posted or maintenance is scheduled.
  </p>
  {#if done}
    <p class="mt-3 text-sm text-success-text" role="status">Check your inbox to confirm</p>
  {:else}
    <form onsubmit={submit} class="mt-3 flex flex-wrap items-start gap-2" novalidate>
      <div class="min-w-56 flex-1 space-y-1">
        <Label for="subscribe-email" class="sr-only">Email address</Label>
        <Input
          id="subscribe-email"
          type="email"
          bind:value={email}
          placeholder="you@example.com"
          autocomplete="email"
          aria-invalid={error ? 'true' : undefined}
        />
        {#if error}<p class="text-xs text-destructive-text" role="alert">{error}</p>{/if}
      </div>
      <Button
        type="submit"
        disabled={submitting}
        style={foreground && accentColor ? `background-color: ${accentColor}; color: ${foreground}` : undefined}
      >
        {submitting ? 'Subscribing...' : 'Subscribe'}
      </Button>
    </form>
  {/if}
</section>
