<script lang="ts">
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

  interface Props {
    open: boolean;
    title: string;
    description?: string;
    confirmLabel: string;
    destructive?: boolean;
    requireText?: string;
    busy?: boolean;
    onConfirm: () => void | Promise<void>;
  }

  let {
    open = $bindable(false),
    title,
    description,
    confirmLabel,
    destructive = true,
    requireText,
    busy = false,
    onConfirm,
  }: Props = $props();

  let typed = $state('');
  let submitting = $state(false);
  let cancelEl = $state<HTMLElement | null>(null);

  const working = $derived(busy || submitting);
  const textOk = $derived(requireText === undefined || typed.trim() === requireText);
  const uid = $props.id();
  const inputId = `confirm-text-${uid}`;

  // Reopening always starts from an empty input.
  $effect(() => {
    if (open) typed = '';
  });

  function setOpen(next: boolean) {
    // Escape and overlay clicks must not dismiss an in-flight action.
    if (!next && working) return;
    open = next;
  }

  async function confirm() {
    if (working || !textOk) return;
    submitting = true;
    try {
      await onConfirm();
      open = false;
    } catch (err) {
      // Callers own user-facing error toasts; the dialog just stays open.
      console.error('Confirm action failed', err);
    } finally {
      submitting = false;
    }
  }

  function onOpenAutoFocus(e: Event) {
    if (destructive && cancelEl) {
      e.preventDefault();
      cancelEl.focus();
    }
  }
</script>

<AlertDialog.Root bind:open={() => open, setOpen}>
  <AlertDialog.Content {onOpenAutoFocus}>
    <AlertDialog.Header>
      <AlertDialog.Title>{title}</AlertDialog.Title>
      {#if description}
        <AlertDialog.Description>{description}</AlertDialog.Description>
      {/if}
    </AlertDialog.Header>

    {#if requireText !== undefined}
      <div class="space-y-2">
        <Label for={inputId}>Type <span class="font-mono font-semibold">{requireText}</span> to confirm</Label>
        <Input id={inputId} bind:value={typed} autocomplete="off" disabled={working} />
      </div>
    {/if}

    <AlertDialog.Footer>
      <Button
        variant="outline"
        class="mt-2 sm:mt-0"
        bind:ref={cancelEl}
        disabled={working}
        onclick={() => setOpen(false)}
      >
        Cancel
      </Button>
      <Button
        variant={destructive ? 'destructive' : 'default'}
        disabled={working || !textOk}
        onclick={confirm}
      >
        {#if working}
          <LoaderCircle class="animate-spin" aria-hidden="true" />
        {/if}
        {confirmLabel}
      </Button>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
