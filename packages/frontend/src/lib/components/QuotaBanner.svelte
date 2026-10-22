<script lang="ts">
  import { untrack } from 'svelte';
  import { getCapabilityUsage, type CapabilityUsage } from '$lib/api/usage';
  import { capabilityLabel } from '$lib/utils/quota';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import X from '@lucide/svelte/icons/x';

  interface Props {
    organizationId: string;
    role: 'owner' | 'admin' | 'member' | null | undefined;
    manageHref?: string;
  }

  let { organizationId, role, manageHref = '/dashboard/settings/usage' }: Props = $props();

  const REFRESH_MS = 5 * 60 * 1000;

  let caps = $state<CapabilityUsage[]>([]);
  // Bumped on dismiss so the derived below re-reads sessionStorage.
  let dismissVersion = $state(0);
  const dismissedInMemory = new Set<string>();

  const canSee = $derived(role === 'owner' || role === 'admin');

  const worst = $derived.by(() => {
    const blocked = caps.find((c) => c.kind === 'quota' && c.state === 'blocked');
    if (blocked) return { state: 'blocked' as const, cap: blocked };
    const grace = caps.find((c) => c.kind === 'quota' && c.state === 'grace');
    if (grace) return { state: 'grace' as const, cap: grace };
    return null;
  });

  function keyFor(orgId: string, state: string): string {
    return `quota-banner:${orgId}:${state}`;
  }

  function isDismissed(key: string): boolean {
    if (dismissedInMemory.has(key)) return true;
    try {
      return sessionStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  }

  const visible = $derived.by(() => {
    dismissVersion;
    if (!canSee || !worst) return null;
    return isDismissed(keyFor(organizationId, worst.state)) ? null : worst;
  });

  function dismiss() {
    if (!worst) return;
    const key = keyFor(organizationId, worst.state);
    dismissedInMemory.add(key);
    try {
      sessionStorage.setItem(key, '1');
    } catch {
      // storage unavailable: the in-memory flag still hides it for this view
    }
    dismissVersion += 1;
  }

  // "Events (this month)" becomes "events"; "API keys" stays as is.
  function bannerLabel(capability: string): string {
    const base = capabilityLabel(capability).replace(/\s*\(.*?\)/g, '').trim();
    return base.length > 1 && base[1] === base[1].toLowerCase()
      ? base[0].toLowerCase() + base.slice(1)
      : base;
  }

  async function refresh(orgId: string) {
    try {
      const res = await getCapabilityUsage(orgId);
      if (orgId === untrack(() => organizationId)) caps = res.capabilities ?? [];
    } catch {
      caps = [];
    }
  }

  $effect(() => {
    const orgId = organizationId;
    caps = [];
    if (!canSee || !orgId) return;
    void refresh(orgId);
    const timer = setInterval(() => void refresh(orgId), REFRESH_MS);
    return () => clearInterval(timer);
  });
</script>

{#if visible}
  <div
    role="status"
    data-testid="quota-banner"
    class="flex items-start gap-3 border-b px-4 py-2 text-sm {visible.state === 'blocked'
      ? 'border-destructive/40 bg-destructive/10 text-destructive-text'
      : 'border-warning/40 bg-warning/10 text-warning-text'}"
  >
    <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
    <p class="flex-1">
      {#if visible.state === 'blocked'}
        New {bannerLabel(visible.cap.capability)} data is being rejected because the limit was reached.
      {:else}
        Your organization is over its {bannerLabel(visible.cap.capability)} limit and is using its grace allowance.
      {/if}
      <a href={manageHref} class="ml-1 font-medium underline underline-offset-2">View usage</a>
    </p>
    <button
      type="button"
      class="rounded p-1 hover:bg-foreground/10"
      aria-label="Dismiss usage banner"
      onclick={dismiss}
    >
      <X class="h-4 w-4" aria-hidden="true" />
    </button>
  </div>
{/if}
