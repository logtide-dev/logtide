<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { currentOrganization } from '$lib/stores/organization';
  import { scopeStore } from '$lib/stores/scope';
  import { layoutStore } from '$lib/stores/layout';
  import { monitoringStore, monitors, monitorsLoading, monitorsError } from '$lib/stores/monitoring';
  import { toastStore } from '$lib/stores/toast';
  import type { Monitor } from '$lib/api/monitoring';
  import { ProjectsAPI } from '$lib/api/projects';
  import { getAuthToken } from '$lib/utils/auth';
  import type { Project } from '@logtide/shared';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import * as Tabs from '$lib/components/ui/tabs';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import ScopeBar from '$lib/components/app/ScopeBar.svelte';
  import MonitorList from '$lib/components/monitoring/MonitorList.svelte';
  import MonitorForm from '$lib/components/monitoring/MonitorForm.svelte';
  import StatusUpdatesPanel from '$lib/components/monitoring/StatusUpdatesPanel.svelte';
  import MaintenancePanel from '$lib/components/monitoring/MaintenancePanel.svelte';
  import StatusPageSettings from '$lib/components/monitoring/StatusPageSettings.svelte';
  import { parseUptimeUrl, writeUptimeUrl, type UptimeTab } from '$lib/components/monitoring/uptime-url';
  import Activity from '@lucide/svelte/icons/activity';
  import Plus from '@lucide/svelte/icons/plus';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import CalendarClock from '@lucide/svelte/icons/calendar-clock';
  import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
  import Settings from '@lucide/svelte/icons/settings';

  const org = $derived($currentOrganization);
  const monitorList = $derived($monitors);
  const loading = $derived($monitorsLoading);
  const error = $derived($monitorsError);

  let projects = $state<Project[]>([]);
  let projectsLoaded = $state(false);
  const projectsAPI = new ProjectsAPI(getAuthToken);

  // The project comes from the shared scope. Until the projects of this
  // organization are loaded a stale id from another organization is ignored.
  const projectId = $derived.by(() => {
    const id = $scopeStore.projectIds[0];
    return projectsLoaded && id && projects.some((p) => p.id === id) ? id : undefined;
  });

  const urlState = $derived(parseUptimeUrl(page.url));
  const activeTab = $derived(urlState.tab);

  function navigate(url: URL, replace: boolean) {
    goto(url, { replaceState: replace, keepFocus: true, noScroll: true });
  }

  function setTab(tab: UptimeTab) {
    navigate(writeUptimeUrl(page.url, { tab }), false);
  }


  let maxWidthClass = $state('max-w-7xl');
  let containerPadding = $state('px-6 py-8');
  $effect(() => {
    const a = layoutStore.maxWidthClass.subscribe((v) => (maxWidthClass = v));
    const b = layoutStore.containerPadding.subscribe((v) => (containerPadding = v));
    return () => {
      a();
      b();
    };
  });

  let formOpen = $state(false);
  let formMode = $state<'create' | 'edit' | 'duplicate'>('create');
  let formMonitor = $state<Monitor | null>(null);

  function openCreate() {
    formMode = 'create';
    formMonitor = null;
    formOpen = true;
  }

  function openEdit(monitor: Monitor) {
    formMode = 'edit';
    formMonitor = monitor;
    formOpen = true;
  }

  function openDuplicate(monitor: Monitor) {
    formMode = 'duplicate';
    formMonitor = monitor;
    formOpen = true;
  }

  $effect(() => {
    const orgId = org?.id;
    if (!orgId) return;
    let cancelled = false;
    projectsLoaded = false;
    projectsAPI
      .getProjects(orgId)
      .then((res) => {
        if (cancelled) return;
        projects = res.projects;
        projectsLoaded = true;
      })
      .catch((err) => {
        if (cancelled) return;
        projectsLoaded = true;
        toastStore.error(err instanceof Error ? err.message : 'Could not load projects');
      });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    const organization = org;
    const pid = projectId;
    if (!organization || !pid) return;
    untrack(() => {
      monitoringStore.load(organization.id, pid);
    });
  });

  // create=1 on the monitors tab opens the create dialog once, then leaves the URL clean.
  $effect(() => {
    if (urlState.create && urlState.tab === 'monitors' && projectId) {
      untrack(() => openCreate());
      navigate(writeUptimeUrl(page.url, { create: false }), true);
    }
  });

  function reloadMonitors() {
    if (org && projectId) monitoringStore.load(org.id, projectId);
  }


  const selectedProject = $derived(projects.find((p) => p.id === projectId));
</script>


<svelte:head>
  <title>Uptime - LogTide</title>
</svelte:head>

{#snippet noProject()}
  <EmptyState
    variant="setup"
    title={projectsLoaded && projects.length === 0 ? 'Create a project first' : 'Select a project'}
    description={projectsLoaded && projects.length === 0
      ? 'Monitors, status updates and the status page belong to a project.'
      : 'Choose a project in the scope bar to see its monitors and status page.'}
  >
    {#snippet actions()}
      {#if projectsLoaded && projects.length === 0}
        <Button size="sm" href="/dashboard/projects">Go to projects</Button>
      {/if}
    {/snippet}
  </EmptyState>
{/snippet}

<div class="container mx-auto flex flex-col gap-2 {containerPadding} {maxWidthClass}">
  <PageHeader
    title="Uptime"
    description="Uptime and health checks for your services"
    appliesTo="project"
  >
    {#snippet actions()}
      <ScopeBar mode="single" {projects} showTime={false} />
      <Button variant="outline" size="sm" onclick={reloadMonitors} aria-label="Refresh">
        <RefreshCw class="h-4 w-4" />
      </Button>
    {/snippet}
  </PageHeader>

  {#if error}
    <EmptyState variant="error" title="Could not load monitors" description={error}>
      {#snippet actions()}
        <Button variant="outline" size="sm" onclick={reloadMonitors}>Try again</Button>
      {/snippet}
    </EmptyState>
  {/if}

  <Tabs.Root value={activeTab} onValueChange={(v) => { if (v) setTab(v as UptimeTab); }}>
    <div class="flex items-center justify-between gap-2 flex-wrap">
      <Tabs.List class="gap-1">
        <Tabs.Trigger value="monitors" class="gap-2">
          <Activity class="h-4 w-4" />
          <span>Monitors</span>
          {#if monitorList.length > 0}
            <Badge variant="secondary" class="ml-1 h-5 px-1.5 text-xs">{monitorList.length.toLocaleString('en-US')}</Badge>
          {/if}
        </Tabs.Trigger>
        <Tabs.Trigger value="status-updates" class="gap-2">
          <AlertTriangle class="h-4 w-4" />
          <span>Status updates</span>
        </Tabs.Trigger>
        <Tabs.Trigger value="maintenance" class="gap-2">
          <CalendarClock class="h-4 w-4" />
          <span>Maintenance</span>
        </Tabs.Trigger>
        <Tabs.Trigger value="status-page" class="gap-2">
          <Settings class="h-4 w-4" />
          <span>Status page</span>
        </Tabs.Trigger>
      </Tabs.List>

      <div class="flex items-center gap-2">
        {#if activeTab === 'monitors' && projectId}
          <Button size="sm" onclick={openCreate}>
            <Plus class="mr-2 h-4 w-4" />
            New monitor
          </Button>
        {/if}
      </div>
    </div>

    <Tabs.Content value="monitors" class="mt-4 space-y-4">
      {#if !projectId}
        {@render noProject()}
      {:else}
        <MonitorList
          monitors={monitorList}
          {loading}
          orgId={org?.id ?? ''}
          bind:status={() => urlState.status, (v) => navigate(writeUptimeUrl(page.url, { status: v }), true)}
          bind:q={() => urlState.q, (v) => navigate(writeUptimeUrl(page.url, { q: v }), true)}
          onEdit={openEdit}
          onDuplicate={openDuplicate}
          onChanged={() => {}}
          onCreate={openCreate}
        />
      {/if}


      <MonitorForm
        bind:open={formOpen}
        mode={formMode}
        monitor={formMonitor}
        orgId={org?.id ?? ''}
        projectId={projectId ?? ''}
        {projects}
        onSaved={reloadMonitors}
      />
    </Tabs.Content>

    <Tabs.Content value="status-updates" class="mt-4">
      {#if !projectId || !org}
        {@render noProject()}
      {:else}
        <StatusUpdatesPanel orgId={org.id} {projectId} monitors={monitorList} prefill={urlState.prefill} />
      {/if}
    </Tabs.Content>

    <Tabs.Content value="maintenance" class="mt-4">
      {#if !projectId || !org}
        {@render noProject()}
      {:else}
        <MaintenancePanel orgId={org.id} {projectId} monitors={monitorList} />
      {/if}
    </Tabs.Content>

    <Tabs.Content value="status-page" class="mt-4">
      {#if !selectedProject || !org}
        {@render noProject()}
      {:else}
        <StatusPageSettings
          orgId={org.id}
          orgSlug={org.slug}
          project={selectedProject}
          monitors={monitorList}
          onProjectChanged={(p) => (projects = projects.map((x) => (x.id === p.id ? p : x)))}
          onSaved={reloadMonitors}
        />
      {/if}
    </Tabs.Content>
  </Tabs.Root>
</div>
