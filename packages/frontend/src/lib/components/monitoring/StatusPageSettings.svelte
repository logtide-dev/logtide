<script lang="ts">
  import { untrack } from 'svelte';
  import type { Project } from '@logtide/shared';
  import type { Monitor } from '$lib/api/monitoring';
  import {
    getStatusPageConfig,
    updateStatusPageComponents,
    updateStatusPageConfig,
  } from '$lib/api/status-page';
  import { toastStore } from '$lib/stores/toast';
  import { organizationStore } from '$lib/stores/organization';
  import ReadOnlyNotice from '$lib/components/settings/ReadOnlyNotice.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Code2 from '@lucide/svelte/icons/code-2';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import StatusBadgeEmbed from './StatusBadgeEmbed.svelte';
  import StatusPageAccess from './StatusPageAccess.svelte';
  import StatusPageBranding from './StatusPageBranding.svelte';
  import StatusPageComponents from './StatusPageComponents.svelte';
  import StatusPageSubscribers from './StatusPageSubscribers.svelte';
  import {
    componentsPayload,
    configFromDraft,
    draftFromConfig,
    rowsFromMonitors,
    validateBranding,
    type BrandingDraft,
    type ComponentRow,
  } from './status-page-form';

  interface Props {
    orgId: string;
    orgSlug: string;
    project: Project;
    monitors: Monitor[];
    onProjectChanged: (p: Project) => void;
    /** Called after the component order or names were saved so the list can reload. */
    onSaved?: () => void;
  }

  let { orgId, orgSlug, project, monitors, onProjectChanged, onSaved }: Props = $props();

  const EMPTY_DRAFT: BrandingDraft = {
    title: '',
    description: '',
    logoUrl: '',
    accentColor: '',
    showMonitorTypes: false,
  };

  let draft = $state<BrandingDraft>({ ...EMPTY_DRAFT });
  let rows = $state<ComponentRow[]>([]);
  let subscriptionsAvailable = $state(false);
  let loaded = $state(false);
  let loadError = $state<string | null>(null);
  let saving = $state(false);
  let baseline = $state('');
  let loadSeq = 0;

  // Branding, components and subscribers are owner/admin only on the server.
  const role = $derived($organizationStore.currentOrganization?.role ?? null);
  const canEdit = $derived(role === 'owner' || role === 'admin');

  const snapshot = $derived(JSON.stringify({ draft, rows }));
  const dirty = $derived(loaded && snapshot !== baseline);
  const errors = $derived(validateBranding(draft));
  const invalid = $derived(Object.keys(errors).length > 0);

  async function load() {
    const mine = ++loadSeq;
    loaded = false;
    loadError = null;
    try {
      const res = await getStatusPageConfig(orgId, project.id);
      if (mine !== loadSeq) return;
      draft = draftFromConfig(res.config);
      rows = rowsFromMonitors(monitors);
      subscriptionsAvailable = res.subscriptionsAvailable;
      baseline = snapshot;
      loaded = true;
    } catch (err) {
      if (mine !== loadSeq) return;
      loadError = err instanceof Error ? err.message : 'Could not load the status page settings';
    }
  }

  $effect(() => {
    orgId;
    project.id;
    untrack(load);
  });

  // Monitors arriving or changing later refresh the rows unless the user is mid edit.
  $effect(() => {
    monitors;
    untrack(() => {
      if (!loaded || dirty) return;
      rows = rowsFromMonitors(monitors);
      baseline = snapshot;
    });
  });

  async function save() {
    if (!canEdit || !dirty || invalid || saving) return;
    saving = true;
    try {
      await Promise.all([
        updateStatusPageConfig(orgId, project.id, configFromDraft(draft)),
        updateStatusPageComponents(orgId, project.id, componentsPayload(rows)),
      ]);
      baseline = snapshot;
      toastStore.success('Status page saved');
      onSaved?.();
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Could not save the status page');
    } finally {
      saving = false;
    }
  }

  const hasPublicUrl = $derived(project.statusPageVisibility !== 'disabled' && !!project.slug && !!orgSlug);
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div>
      <h2 class="text-base font-semibold">Status page</h2>
      <p class="text-sm text-muted-foreground">
        Choose who can see it and how your components are presented.
      </p>
    </div>
    <div class="flex items-center gap-2">
      {#if hasPublicUrl}
        <Button size="sm" variant="outline" href="/status/{orgSlug}/{project.slug}" target="_blank" class="gap-2">
          View page
          <ExternalLink class="h-3.5 w-3.5" />
        </Button>
      {/if}
      <Button size="sm" disabled={!canEdit || !dirty || invalid || saving} onclick={save}>
        {saving ? 'Saving...' : 'Save changes'}
      </Button>
    </div>
  </div>

  {#if !canEdit}
    <ReadOnlyNotice what="the status page settings" />
  {/if}

  <StatusPageAccess {orgId} {orgSlug} {project} {onProjectChanged} />

  {#if loadError}
    <EmptyState variant="error" title="Could not load the status page settings" description={loadError}>
      {#snippet actions()}
        <Button variant="outline" size="sm" onclick={load}>Try again</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <StatusPageBranding bind:draft disabled={!loaded || saving || !canEdit} />
    <StatusPageComponents bind:rows disabled={!loaded || saving || !canEdit} />

    {#if loaded && subscriptionsAvailable && canEdit}
      <StatusPageSubscribers {orgId} projectId={project.id} />
    {/if}
  {/if}

  {#if project.statusPageVisibility === 'public' && project.slug}
    <div class="rounded-lg border bg-card px-4 py-2">
      <Collapsible.Root>
        <Collapsible.Trigger
          class="group flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
        >
          <span class="flex items-center gap-2">
            <Code2 class="h-4 w-4 text-muted-foreground" />
            Embed badge
          </span>
          <ChevronDown
            class="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
          />
        </Collapsible.Trigger>
        <Collapsible.Content class="pt-3">
          <StatusBadgeEmbed {orgSlug} projectSlug={project.slug} />
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  {/if}
</div>
