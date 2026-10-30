<script lang="ts">
  import type { ActiveIssues } from '$lib/api/admin';
  import { stateTone } from '$lib/utils/severity';
  import { formatCount } from '$lib/utils/format-number';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import ShieldAlert from '@lucide/svelte/icons/shield-alert';
  import { activeIssueItems } from './overview-health';

  interface Props {
    issues: ActiveIssues | null;
    loading: boolean;
    error?: string | null;
  }

  let { issues, loading, error = null }: Props = $props();

  const items = $derived(issues ? activeIssueItems(issues) : []);
  const allClear = $derived(items.length > 0 && items.every((i) => i.count === 0));
</script>

<Card>
  <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
    <CardTitle class="text-sm font-medium">Active issues</CardTitle>
    <ShieldAlert class="h-4 w-4 text-muted-foreground" />
  </CardHeader>
  <CardContent>
    {#if loading && !issues}
      <div class="space-y-2" aria-busy="true">
        <Skeleton class="h-5 w-full" />
        <Skeleton class="h-5 w-full" />
        <Skeleton class="h-5 w-full" />
      </div>
    {:else if !issues}
      <p class="text-sm text-muted-foreground">{error ?? 'Active issues are unavailable.'}</p>
    {:else}
      <ul class="space-y-1.5" data-testid="active-issues">
        {#each items as item (item.key)}
          <li class="flex items-baseline justify-between gap-3 text-sm">
            <span>
              {item.label}
              <span class="text-xs text-muted-foreground">({item.window})</span>
            </span>
            <span
              class="font-semibold tabular-nums {item.count > 0 ? stateTone(item.tone).text : 'text-muted-foreground'}"
            >
              {formatCount(item.count)}
            </span>
          </li>
        {/each}
      </ul>
      {#if allClear}
        <p class="mt-2 text-xs {stateTone('ok').text}">All clear</p>
      {/if}
    {/if}
  </CardContent>
</Card>
