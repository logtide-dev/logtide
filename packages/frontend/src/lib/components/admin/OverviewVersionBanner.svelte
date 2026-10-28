<script lang="ts">
  import type { VersionCheckResult } from '$lib/api/admin';
  import { stateTone } from '$lib/utils/severity';
  import { formatTimestamp } from '$lib/utils/datetime';
  import ArrowUpCircle from '@lucide/svelte/icons/arrow-up-circle';
  import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
  import ExternalLink from '@lucide/svelte/icons/external-link';

  interface Props {
    version: VersionCheckResult | null;
    /** True when the request itself failed (as opposed to GitHub being unreachable). */
    failed?: boolean;
  }

  let { version, failed = false }: Props = $props();

  const target = $derived(
    version ? (version.channel === 'beta' ? (version.latestBeta ?? version.latestStable) : version.latestStable) : null,
  );
  const reachable = $derived(!!version && (version.latestStable !== null || version.latestBeta !== null));
  const updateAvailable = $derived(reachable && !!version?.updateAvailable && !!target);
</script>

{#if version || failed}
  <div
    class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-2.5 text-sm {updateAvailable
      ? stateTone('acknowledged').badge
      : 'border-border bg-card'}"
    data-testid="version-banner"
  >
    {#if !version}
      <CheckCircle2 class="size-4 text-muted-foreground" />
      <span class="text-muted-foreground">Version check unavailable.</span>
    {:else if !reachable}
      <CheckCircle2 class="size-4 text-muted-foreground" />
      <span class="text-muted-foreground">
        Version check unavailable (could not reach GitHub). Running <span class="font-mono">v{version.currentVersion}</span>.
      </span>
    {:else if updateAvailable && target}
      <ArrowUpCircle class="size-4" />
      <span class="font-medium">Update available</span>
      <span class="font-mono text-xs">v{version.currentVersion} to v{target.version}</span>
      <span class="text-xs text-muted-foreground">
        {target.name}{target.prerelease ? ' (pre-release)' : ''}, {version.channel} channel
      </span>
      <a
        href={target.url}
        target="_blank"
        rel="noopener noreferrer"
        class="ml-auto inline-flex items-center gap-1 font-medium hover:underline"
      >
        View release
        <ExternalLink class="size-3.5" />
      </a>
    {:else}
      <CheckCircle2 class="size-4 {stateTone('ok').text}" />
      <span class="font-medium">Up to date</span>
      <span class="font-mono text-xs text-muted-foreground">v{version.currentVersion}</span>
      <span class="text-xs text-muted-foreground">
        {version.channel} channel, checked {formatTimestamp(version.checkedAt, { precision: 'minute' })}
      </span>
    {/if}
  </div>
{/if}
