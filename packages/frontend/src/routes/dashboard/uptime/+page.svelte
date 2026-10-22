<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { currentOrganization } from '$lib/stores/organization';
  import { scopeStore } from '$lib/stores/scope';
  import { monitoringStore, monitors, monitorsLoading, monitorsError } from '$lib/stores/monitoring';
  import { toastStore } from '$lib/stores/toast';
  import type { Monitor } from '$lib/api/monitoring';
  import { ProjectsAPI } from '$lib/api/projects';
  import { getAuthToken } from '$lib/utils/auth';
  import type { Project } from '@logtide/shared';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as Select from '$lib/components/ui/select';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import ScopeBar from '$lib/components/app/ScopeBar.svelte';
  import StatusBadgeEmbed from '$lib/components/monitoring/StatusBadgeEmbed.svelte';
  import MonitorList from '$lib/components/monitoring/MonitorList.svelte';
  import MonitorForm from '$lib/components/monitoring/MonitorForm.svelte';
  import StatusUpdatesPanel from '$lib/components/monitoring/StatusUpdatesPanel.svelte';
  import MaintenancePanel from '$lib/components/monitoring/MaintenancePanel.svelte';
  import { parseUptimeUrl, writeUptimeUrl, type UptimeTab } from '$lib/components/monitoring/uptime-url';
  import Activity from '@lucide/svelte/icons/activity';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Code2 from '@lucide/svelte/icons/code-2';
  import Plus from '@lucide/svelte/icons/plus';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import ExternalLink from '@lucide/svelte/icons/external-link';
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


  // Display labels for the shared Select dropdowns
  const statusPageVisibilityLabels: Record<string, string> = {
    disabled: 'Disabled',
    public: 'Public',
    password: 'Password protected',
    members_only: 'Members only',
  };

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
  let statusPagePassword = $state('');
  let savingVisibility = $state(false);

  async function updateVisibility(visibility: string) {
    if (!org || !projectId || !selectedProject) return;
    savingVisibility = true;
    try {
      const input: Record<string, unknown> = { statusPageVisibility: visibility };
      if (visibility === 'password' && statusPagePassword) {
        input.statusPagePassword = statusPagePassword;
      }
      const res = await projectsAPI.updateProject(org.id, projectId, input as any);
      projects = projects.map((p) => p.id === projectId ? { ...p, statusPageVisibility: res.project.statusPageVisibility } : p);
      toastStore.success(`Status page: ${visibility.replace('_', ' ')}`);
      if (visibility !== 'password') statusPagePassword = '';
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Failed to update status page');
    } finally {
      savingVisibility = false;
    }
  }

  async function savePassword() {
    if (!org || !projectId || !statusPagePassword) return;
    savingVisibility = true;
    try {
      await projectsAPI.updateProject(org.id, projectId, {
        statusPageVisibility: 'password',
        statusPagePassword,
      });
      toastStore.success('Password updated');
      statusPagePassword = '';
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      savingVisibility = false;
    }
  }

  let slugInput = $state('');
  let slugError = $state<string | null>(null);
  let savingSlug = $state(false);

  $effect(() => {
    if (selectedProject) {
      slugInput = selectedProject.slug ?? '';
      slugError = null;
    }
  });

  async function saveProjectSlug() {
    if (!org || !projectId || !slugInput) return;
    slugError = null;
    savingSlug = true;
    try {
      const res = await projectsAPI.updateProject(org.id, projectId, { slug: slugInput });
      projects = projects.map((p) => p.id === projectId ? { ...p, slug: res.project.slug } : p);
      toastStore.success('Slug updated');
    } catch (err) {
      slugError = err instanceof Error ? err.message : 'Failed to update slug';
    } finally {
      savingSlug = false;
    }
  }
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

<div class="flex flex-col gap-2 p-6">
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
        {:else if activeTab === 'status-page' && selectedProject?.statusPageVisibility !== 'disabled' && selectedProject?.slug && org?.slug}
          <Button size="sm" variant="outline" href="/status/{org.slug}/{selectedProject.slug}" target="_blank" class="gap-2">
            View page
            <ExternalLink class="h-3.5 w-3.5" />
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

    <!-- ================================================================
         STATUS PAGE TAB
         ================================================================ -->
    <Tabs.Content value="status-page" class="mt-4 space-y-4">
      {#if selectedProject}
        <div class="rounded-lg border bg-card px-4 py-3 space-y-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <label class="text-sm font-medium">Status page</label>
          <Select.Root
            type="single"
            value={selectedProject.statusPageVisibility}
            onValueChange={(v) => { if (v) updateVisibility(v); }}
            disabled={savingVisibility}
          >
            <Select.Trigger class="h-8 w-[190px]">
              {statusPageVisibilityLabels[selectedProject.statusPageVisibility] ?? selectedProject.statusPageVisibility}
            </Select.Trigger>
            <Select.Content>
              {#each Object.entries(statusPageVisibilityLabels) as [value, label]}
                <Select.Item {value}>{label}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
          {#if selectedProject.statusPageVisibility !== 'disabled'}
            <Badge variant="outline" class="text-xs">
              {selectedProject.statusPageVisibility === 'public' ? 'Live' : selectedProject.statusPageVisibility === 'password' ? 'Protected' : 'Private'}
            </Badge>
          {/if}
        </div>
        {#if selectedProject.statusPageVisibility !== 'disabled' && selectedProject.slug && org?.slug}
          <a
            href="/status/{org.slug}/{selectedProject.slug}"
            target="_blank"
            class="flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            View status page
            <ExternalLink class="h-3 w-3" />
          </a>
        {/if}
      </div>
      {#if selectedProject.statusPageVisibility === 'password'}
        <div class="flex items-center gap-2">
          <input
            type="password"
            bind:value={statusPagePassword}
            placeholder="Set or update password"
            class="h-8 w-64 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <Button size="sm" disabled={!statusPagePassword || savingVisibility} onclick={savePassword}>
            Save password
          </Button>
        </div>
      {/if}

      {#if selectedProject.statusPageVisibility !== 'disabled'}
        <div class="flex flex-col gap-1 pt-1">
          <label for="project-slug-input" class="text-sm font-medium">Public URL slug</label>
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted-foreground whitespace-nowrap">
              /status/{org?.slug}/
            </span>
            <input
              id="project-slug-input"
              type="text"
              bind:value={slugInput}
              placeholder="project-slug"
              class="h-8 w-48 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <Button
              size="sm"
              disabled={!slugInput || slugInput === selectedProject.slug || savingSlug}
              onclick={saveProjectSlug}
            >
              Save
            </Button>
          </div>
          {#if slugError}
            <p class="text-xs text-destructive">{slugError}</p>
          {/if}
        </div>
      {/if}

          {#if selectedProject.statusPageVisibility === 'public' && selectedProject.slug}
            <div class="border-t pt-2 mt-1">
              <Collapsible.Root>
                <Collapsible.Trigger class="group flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm font-medium hover:bg-accent transition-colors">
                  <span class="flex items-center gap-2">
                    <Code2 class="h-4 w-4 text-muted-foreground" />
                    Embed badge
                  </span>
                  <ChevronDown class="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </Collapsible.Trigger>
                <Collapsible.Content class="pt-3">
                  <StatusBadgeEmbed orgSlug={org?.slug ?? ''} projectSlug={selectedProject.slug} />
                </Collapsible.Content>
              </Collapsible.Root>
            </div>
          {/if}
        </div>
      {:else}
        <div class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <Settings class="h-8 w-8 text-muted-foreground" />
          <p class="text-sm text-muted-foreground">Select a project to configure its status page.</p>
        </div>
      {/if}
    </Tabs.Content>
  </Tabs.Root>
</div>
