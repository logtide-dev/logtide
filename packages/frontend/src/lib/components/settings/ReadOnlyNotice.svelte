<script lang="ts">
  import Lock from '@lucide/svelte/icons/lock';

  interface Props {
    requiredRole?: 'admin' | 'owner';
    what: string;
  }

  let { requiredRole = 'admin', what }: Props = $props();

  let who = $derived(
    requiredRole === 'owner' ? 'the organization owner' : 'organization owners and admins'
  );
</script>

<div
  class="flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
  role="note"
  data-testid="read-only-notice"
>
  <Lock class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
  <p>Only {who} can change {what}. You can view the current configuration.</p>
</div>
