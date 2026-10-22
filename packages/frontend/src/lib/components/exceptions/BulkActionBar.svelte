<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';
  import AssigneePicker from './AssigneePicker.svelte';
  import IgnoreDialog from './IgnoreDialog.svelte';
  import type { AssigneeMember, IgnoreOptions } from './error-status';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import X from '@lucide/svelte/icons/x';

  interface Props {
    count: number;
    members: AssigneeMember[];
    busy?: boolean;
    onResolve: () => void;
    onReopen: () => void;
    onIgnore: (options: IgnoreOptions) => void | Promise<void>;
    onAssign: (userId: string | null) => void;
    onClear: () => void;
  }

  let { count, members, busy = false, onResolve, onReopen, onIgnore, onAssign, onClear }: Props = $props();

  let ignoreOpen = $state(false);
</script>

<div
  class="flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 px-3 py-2"
  role="toolbar"
  aria-label="Bulk actions"
>
  <span class="text-sm font-medium">{count.toLocaleString('en-US')} selected</span>
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="outline" size="sm" class="gap-1" disabled={busy} onclick={onResolve}>
      <CircleCheck class="w-4 h-4" aria-hidden="true" />
      Resolve
    </Button>
    <Button variant="outline" size="sm" class="gap-1" disabled={busy} onclick={onReopen}>
      <RotateCcw class="w-4 h-4" aria-hidden="true" />
      Reopen
    </Button>
    <Button variant="outline" size="sm" class="gap-1" disabled={busy} onclick={() => (ignoreOpen = true)}>
      <EyeOff class="w-4 h-4" aria-hidden="true" />
      Ignore
    </Button>
    <AssigneePicker
      {members}
      value={null}
      disabled={busy}
      triggerLabel="Assign"
      ariaLabel="Assign selected errors"
      onChange={onAssign}
    />
  </div>
  <Button variant="ghost" size="sm" class="ml-auto gap-1" disabled={busy} onclick={onClear}>
    <X class="w-4 h-4" aria-hidden="true" />
    Clear selection
  </Button>
</div>

<IgnoreDialog bind:open={ignoreOpen} {busy} onConfirm={onIgnore} />
