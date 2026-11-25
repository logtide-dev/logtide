<!--
  Detail drawer of a catalog metric: description, unit, type, first/last seen,
  attributes with sample values, the sources sending it, the dashboards using
  it and an "Open in Explore" link.

  Props:
    entry          the catalog row (shown right away; null = closed)
    organizationId
    projectIds     string[] | null
    exploreHref    link target of "Open in Explore"
    onClose        called when the drawer closes
    api            client, defaults to metricsV2API (injectable for tests)
-->
<script lang="ts">
  import type { MetricCatalogDetail, MetricCatalogEntry } from '@logtide/shared';
  import { metricsV2API, type MetricsV2API } from '$lib/api/metrics-v2';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Badge } from '$lib/components/ui/badge';
  import Timestamp from '$lib/components/app/Timestamp.svelte';

  interface Props {
    entry: MetricCatalogEntry | null;
    organizationId: string;
    projectIds?: string[] | null;
    exploreHref: string;
    onClose: () => void;
    api?: Pick<MetricsV2API, 'getCatalogEntry'>;
  }

  let { entry, organizationId, projectIds = null, exploreHref, onClose, api = metricsV2API }: Props = $props();

  let detail = $state<MetricCatalogDetail | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    const name = entry?.name;
    const org = organizationId;
    const projects = projectIds;
    detail = null;
    error = null;
    if (!name) return;
    let cancelled = false;
    loading = true;
    api
      .getCatalogEntry(name, { organizationId: org, projectIds: projects })
      .then((d) => {
        if (!cancelled) detail = d;
      })
      .catch((e) => {
        if (!cancelled) error = e instanceof Error ? e.message : 'Could not load the metric';
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  const shown = $derived(detail?.entry ?? entry);
  const encode = encodeURIComponent;
</script>

<Dialog.Root open={entry !== null} onOpenChange={(o) => !o && onClose()}>
  <Dialog.Content
    class="left-auto right-0 top-0 h-dvh max-h-dvh w-full max-w-xl translate-x-0 translate-y-0 content-start rounded-none sm:rounded-none"
    aria-label="Metric details"
  >
    {#if shown}
      <Dialog.Header>
        <Dialog.Title class="break-all pr-6 font-mono text-base">{shown.name}</Dialog.Title>
        <Dialog.Description>{shown.description || 'No description provided by the sender.'}</Dialog.Description>
      </Dialog.Header>

      <div class="space-y-5 text-sm">
        <a
          href={exploreHref}
          class="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Open in Explore
        </a>

        <dl class="grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <dt class="text-xs text-muted-foreground">Type</dt>
            <dd><Badge variant="outline">{shown.type}</Badge></dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">Unit</dt>
            <dd>{shown.unit || 'none'}</dd>
          </div>
          {#if shown.type === 'sum'}
            <div>
              <dt class="text-xs text-muted-foreground">Monotonic</dt>
              <dd>{shown.isMonotonic ? 'Yes' : 'No'}</dd>
            </div>
          {/if}
          <div>
            <dt class="text-xs text-muted-foreground">Projects</dt>
            <dd>{shown.projectIds.length.toLocaleString('en-US')}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">First seen</dt>
            <dd><Timestamp value={shown.firstSeen} precision="minute" /></dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">Last seen</dt>
            <dd><Timestamp value={shown.lastSeen} precision="minute" /></dd>
          </div>
        </dl>

        {#if loading}
          <p class="text-muted-foreground" role="status">Loading details</p>
        {:else if error}
          <p class="text-destructive-text" role="alert">{error}</p>
        {:else if detail}
          {#each [{ title: 'Resource attributes', items: detail.attributes.resource }, { title: 'Metric attributes', items: detail.attributes.metric }] as group (group.title)}
            <section aria-label={group.title}>
              <h3 class="mb-2 font-medium">{group.title}</h3>
              {#if group.items.length === 0}
                <p class="text-muted-foreground">None.</p>
              {:else}
                <ul class="space-y-2">
                  {#each group.items as a (a.key)}
                    <li>
                      <p class="font-mono text-xs">{a.key}</p>
                      <p class="truncate text-xs text-muted-foreground" title={a.values.join(', ')}>
                        {a.values.slice(0, 6).join(', ')}{a.values.length > 6 ? `, +${a.values.length - 6} more` : ''}
                      </p>
                    </li>
                  {/each}
                </ul>
              {/if}
            </section>
          {/each}

          <section aria-label="Sources">
            <h3 class="mb-2 font-medium">Sources</h3>
            {#if detail.sources.hosts.length === 0 && detail.sources.services.length === 0}
              <p class="text-muted-foreground">No host or service reports this metric.</p>
            {:else}
              <ul class="flex flex-wrap gap-2">
                {#each detail.sources.hosts as h (h)}
                  <li>
                    <a class="rounded-full border border-border px-2.5 py-0.5 text-xs hover:bg-muted" href="/dashboard/metrics/hosts/{encode(h)}">
                      host {h}
                    </a>
                  </li>
                {/each}
                {#each detail.sources.services as s (s)}
                  <li>
                    <a class="rounded-full border border-border px-2.5 py-0.5 text-xs hover:bg-muted" href="/dashboard/metrics/services/{encode(s)}">
                      service {s}
                    </a>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>

          <section aria-label="Used in dashboards">
            <h3 class="mb-2 font-medium">Used in dashboards</h3>
            {#if detail.usedIn.dashboards.length === 0}
              <p class="text-muted-foreground">No dashboard uses this metric yet.</p>
            {:else}
              <ul class="space-y-1">
                {#each detail.usedIn.dashboards as d (d.id)}
                  <li><a class="text-primary hover:underline" href="/dashboard?id={encode(d.id)}">{d.name}</a></li>
                {/each}
              </ul>
            {/if}
          </section>
        {/if}
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
