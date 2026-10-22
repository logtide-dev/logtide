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
  import { getApiBaseUrl } from '$lib/config';
  import type { Project } from '@logtide/shared';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Select from '$lib/components/ui/select';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import ScopeBar from '$lib/components/app/ScopeBar.svelte';
  import StatusBadgeEmbed from '$lib/components/monitoring/StatusBadgeEmbed.svelte';
  import MonitorList from '$lib/components/monitoring/MonitorList.svelte';
  import MonitorForm from '$lib/components/monitoring/MonitorForm.svelte';
  import { parseUptimeUrl, writeUptimeUrl, type UptimeTab } from '$lib/components/monitoring/uptime-url';
  import Activity from '@lucide/svelte/icons/activity';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Code2 from '@lucide/svelte/icons/code-2';
  import Plus from '@lucide/svelte/icons/plus';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Pencil from '@lucide/svelte/icons/pencil';
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
  const incidentSeverityLabels: Record<string, string> = {
    minor: 'Minor',
    major: 'Major',
    critical: 'Critical',
  };
  const incidentStatusLabels: Record<string, string> = {
    investigating: 'Investigating',
    identified: 'Identified',
    monitoring: 'Monitoring',
    resolved: 'Resolved',
  };
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
      loadIncidents();
      loadMaintenances();
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

  interface StatusIncident {
    id: string;
    organizationId: string;
    projectId: string;
    title: string;
    status: string;
    severity: string;
    createdAt: string;
    updatedAt: string;
    resolvedAt: string | null;
  }

  let statusIncidents = $state<StatusIncident[]>([]);
  let statusIncidentsError = $state<string | null>(null);
  let maintenancesError = $state<string | null>(null);
  let showIncidentForm = $state(false);
  let incidentTitle = $state('');
  let incidentSeverity = $state('minor');
  let incidentMessage = $state('');
  let submittingIncident = $state(false);

  let showUpdateForm = $state<string | null>(null);
  let updateStatus = $state('investigating');
  let updateMessage = $state('');
  let submittingUpdate = $state(false);
  const updatingIncident = $derived(
    showUpdateForm ? statusIncidents.find((i) => i.id === showUpdateForm) ?? null : null
  );

  async function apiRequest(path: string, options: RequestInit = {}) {
    const token = getAuthToken();
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
    return res;
  }

  async function loadIncidents() {
    if (!org || !projectId) return;
    statusIncidentsError = null;
    try {
      const res = await apiRequest(`/status-incidents?organizationId=${org.id}&projectId=${projectId}`);
      if (!res.ok) throw new Error(`Failed to load incidents (${res.status})`);
      const data = await res.json();
      statusIncidents = data.incidents;
    } catch (err) {
      statusIncidentsError = err instanceof Error ? err.message : 'Failed to load incidents';
    }
  }

  async function createIncident(e: Event) {
    e.preventDefault();
    if (!org || !projectId) return;
    submittingIncident = true;
    try {
      const res = await apiRequest('/status-incidents', {
        method: 'POST',
        body: JSON.stringify({
          organizationId: org.id,
          projectId,
          title: incidentTitle,
          severity: incidentSeverity,
          message: incidentMessage || undefined,
        }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      toastStore.success('Incident created');
      showIncidentForm = false;
      incidentTitle = ''; incidentSeverity = 'minor'; incidentMessage = '';
      await loadIncidents();
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Failed to create incident');
    } finally { submittingIncident = false; }
  }

  async function addIncidentUpdate(incidentId: string) {
    if (!org || !updateMessage) return;
    submittingUpdate = true;
    try {
      const res = await apiRequest(`/status-incidents/${incidentId}/updates?organizationId=${org.id}`, {
        method: 'POST',
        body: JSON.stringify({ status: updateStatus, message: updateMessage }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      toastStore.success('Update posted');
      showUpdateForm = null;
      updateMessage = ''; updateStatus = 'investigating';
      await loadIncidents();
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Failed to add update');
    } finally { submittingUpdate = false; }
  }

  async function deleteIncident(id: string) {
    if (!org) return;
    try {
      await apiRequest(`/status-incidents/${id}?organizationId=${org.id}`, { method: 'DELETE' });
      toastStore.success('Incident deleted');
      await loadIncidents();
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Failed to delete incident');
    }
  }

  interface MaintenanceItem {
    id: string;
    title: string;
    description: string | null;
    status: string;
    scheduledStart: string;
    scheduledEnd: string;
    autoUpdateStatus: boolean;
  }

  let maintenances = $state<MaintenanceItem[]>([]);
  let showMaintenanceForm = $state(false);
  let maintTitle = $state('');
  let maintDescription = $state('');
  let maintStart = $state('');
  let maintEnd = $state('');
  let maintAutoSuppress = $state(true);
  let submittingMaintenance = $state(false);

  async function loadMaintenances() {
    if (!org || !projectId) return;
    maintenancesError = null;
    try {
      const res = await apiRequest(`/maintenances?organizationId=${org.id}&projectId=${projectId}`);
      if (!res.ok) throw new Error(`Failed to load maintenances (${res.status})`);
      const data = await res.json();
      maintenances = data.maintenances;
    } catch (err) {
      maintenancesError = err instanceof Error ? err.message : 'Failed to load maintenances';
    }
  }

  async function createMaintenance(e: Event) {
    e.preventDefault();
    if (!org || !projectId) return;
    if (!maintStart || !maintEnd) {
      toastStore.error('Start and end times are required');
      return;
    }
    submittingMaintenance = true;
    try {
      const res = await apiRequest('/maintenances', {
        method: 'POST',
        body: JSON.stringify({
          organizationId: org.id,
          projectId,
          title: maintTitle,
          description: maintDescription || undefined,
          scheduledStart: new Date(maintStart).toISOString(),
          scheduledEnd: new Date(maintEnd).toISOString(),
          autoUpdateStatus: maintAutoSuppress,
        }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      toastStore.success('Maintenance scheduled');
      showMaintenanceForm = false;
      maintTitle = ''; maintDescription = ''; maintStart = ''; maintEnd = '';
      await loadMaintenances();
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Failed to schedule maintenance');
    } finally { submittingMaintenance = false; }
  }

  async function deleteMaintenance(id: string) {
    if (!org) return;
    try {
      await apiRequest(`/maintenances/${id}?organizationId=${org.id}`, { method: 'DELETE' });
      toastStore.success('Maintenance deleted');
      await loadMaintenances();
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Failed to delete maintenance');
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
          {#if statusIncidents.length > 0}
            <Badge variant="secondary" class="ml-1 h-5 px-1.5 text-xs">{statusIncidents.length.toLocaleString('en-US')}</Badge>
          {/if}
        </Tabs.Trigger>
        <Tabs.Trigger value="maintenance" class="gap-2">
          <CalendarClock class="h-4 w-4" />
          <span>Maintenance</span>
          {#if maintenances.length > 0}
            <Badge variant="secondary" class="ml-1 h-5 px-1.5 text-xs">{maintenances.length.toLocaleString('en-US')}</Badge>
          {/if}
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
        {:else if activeTab === 'status-updates' && projectId}
          <Button size="sm" onclick={() => (showIncidentForm = !showIncidentForm)}>
            <Plus class="mr-2 h-4 w-4" />
            New status update
          </Button>
        {:else if activeTab === 'maintenance' && projectId}
          <Button size="sm" onclick={() => (showMaintenanceForm = !showMaintenanceForm)}>
            <Plus class="mr-2 h-4 w-4" />
            Schedule maintenance
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

    <!-- ================================================================
         INCIDENTS TAB
         ================================================================ -->
    <Tabs.Content value="status-updates" class="mt-4 space-y-3">
      {#if !projectId}
        {@render noProject()}
      {:else}
      <Dialog.Root open={showIncidentForm} onOpenChange={(o) => (showIncidentForm = o)}>
        <Dialog.Content class="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <Dialog.Header>
            <Dialog.Title>New Incident</Dialog.Title>
          </Dialog.Header>
          <form onsubmit={createIncident} class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div class="sm:col-span-2">
              <label class="mb-1 block text-sm font-medium">Title</label>
              <input bind:value={incidentTitle} required maxlength="255" placeholder="Investigating API latency issues"
                class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium">Severity</label>
              <Select.Root type="single" value={incidentSeverity} onValueChange={(v) => { if (v) incidentSeverity = v as typeof incidentSeverity; }}>
                <Select.Trigger class="w-full">
                  {incidentSeverityLabels[incidentSeverity] ?? incidentSeverity}
                </Select.Trigger>
                <Select.Content>
                  {#each Object.entries(incidentSeverityLabels) as [value, label]}
                    <Select.Item {value}>{label}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>
            <div class="sm:col-span-2">
              <label class="mb-1 block text-sm font-medium">Initial message (optional)</label>
              <textarea bind:value={incidentMessage} rows="2" maxlength="5000" placeholder="We're investigating increased error rates..."
                class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"></textarea>
            </div>
            <div class="sm:col-span-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onclick={() => (showIncidentForm = false)}>Cancel</Button>
              <Button type="submit" disabled={submittingIncident}>{submittingIncident ? 'Creating...' : 'Create incident'}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Root>

      {#if statusIncidentsError}
        <div class="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {statusIncidentsError}
        </div>
      {/if}

      {#if statusIncidents.length === 0}
        <div class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <AlertTriangle class="h-8 w-8 text-muted-foreground" />
          <p class="text-sm text-muted-foreground">No incidents reported.</p>
          <Button variant="ghost" size="sm" onclick={() => (showIncidentForm = true)}>
            <Plus class="mr-2 h-4 w-4" />
            Report an incident
          </Button>
        </div>
      {:else}
        <div class="space-y-2">
          {#each statusIncidents as incident (incident.id)}
            <div class="rounded-lg border bg-card px-4 py-3">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <Badge variant={incident.severity === 'critical' ? 'destructive' : 'outline'} class="text-xs capitalize">{incident.severity}</Badge>
                  <span class="text-sm font-medium">{incident.title}</span>
                  <Badge variant="outline" class="text-xs capitalize">{incident.status}</Badge>
                </div>
                <div class="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onclick={() => { showUpdateForm = incident.id; updateStatus = incident.status; updateMessage = ''; }}>
                    <Pencil class="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onclick={() => deleteIncident(incident.id)}>
                    <Trash2 class="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
              <p class="text-xs text-muted-foreground mt-1">{new Date(incident.createdAt).toLocaleString('en-US')}</p>
            </div>
          {/each}
        </div>
      {/if}

      <Dialog.Root open={showUpdateForm !== null} onOpenChange={(o) => { if (!o) { showUpdateForm = null; updateMessage = ''; } }}>
        <Dialog.Content class="sm:max-w-xl">
          <Dialog.Header>
            <Dialog.Title>Post incident update</Dialog.Title>
            {#if updatingIncident}
              <Dialog.Description>{updatingIncident.title}</Dialog.Description>
            {/if}
          </Dialog.Header>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label class="mb-1 block text-xs font-medium">Status</label>
              <Select.Root type="single" value={updateStatus} onValueChange={(v) => { if (v) updateStatus = v as typeof updateStatus; }}>
                <Select.Trigger class="w-full">
                  {incidentStatusLabels[updateStatus] ?? updateStatus}
                </Select.Trigger>
                <Select.Content>
                  {#each Object.entries(incidentStatusLabels) as [value, label]}
                    <Select.Item {value}>{label}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>
            <div class="sm:col-span-2">
              <label class="mb-1 block text-xs font-medium">Message</label>
              <textarea bind:value={updateMessage} rows="3" required maxlength="5000" placeholder="Update message..."
                class="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"></textarea>
            </div>
            <div class="sm:col-span-2 flex justify-end gap-2">
              <Button variant="outline" size="sm" onclick={() => { showUpdateForm = null; updateMessage = ''; }}>Cancel</Button>
              <Button
                size="sm"
                disabled={submittingUpdate || !updateMessage || !showUpdateForm}
                onclick={() => showUpdateForm && addIncidentUpdate(showUpdateForm)}
              >
                {submittingUpdate ? 'Posting...' : 'Post update'}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Root>
          {/if}
    </Tabs.Content>

    <!-- ================================================================
         MAINTENANCE TAB
         ================================================================ -->
    <Tabs.Content value="maintenance" class="mt-4 space-y-3">
      {#if !projectId}
        {@render noProject()}
      {:else}
      <Dialog.Root open={showMaintenanceForm} onOpenChange={(o) => (showMaintenanceForm = o)}>
        <Dialog.Content class="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <Dialog.Header>
            <Dialog.Title>Schedule maintenance</Dialog.Title>
          </Dialog.Header>
          <form onsubmit={createMaintenance} class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div class="sm:col-span-2">
              <label class="mb-1 block text-sm font-medium">Title</label>
              <input bind:value={maintTitle} required maxlength="255" placeholder="Database migration"
                class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div class="sm:col-span-2">
              <label class="mb-1 block text-sm font-medium">Description (optional)</label>
              <textarea bind:value={maintDescription} rows="2" maxlength="5000" placeholder="Planned database upgrade..."
                class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"></textarea>
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium">Start</label>
              <input type="datetime-local" bind:value={maintStart} required
                class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium">End</label>
              <input type="datetime-local" bind:value={maintEnd} required
                class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div class="sm:col-span-2">
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" bind:checked={maintAutoSuppress} class="rounded" />
                Suppress monitor alerts during maintenance
              </label>
            </div>
            <div class="sm:col-span-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onclick={() => (showMaintenanceForm = false)}>Cancel</Button>
              <Button type="submit" disabled={submittingMaintenance}>{submittingMaintenance ? 'Scheduling...' : 'Schedule maintenance'}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Root>

      {#if maintenancesError}
        <div class="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {maintenancesError}
        </div>
      {/if}

      {#if maintenances.length === 0}
        <div class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <CalendarClock class="h-8 w-8 text-muted-foreground" />
          <p class="text-sm text-muted-foreground">No scheduled maintenances.</p>
          <Button variant="ghost" size="sm" onclick={() => (showMaintenanceForm = true)}>
            <Plus class="mr-2 h-4 w-4" />
            Schedule one
          </Button>
        </div>
      {:else}
        <div class="space-y-2">
          {#each maintenances as m (m.id)}
            <div class="rounded-lg border bg-card px-4 py-3">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <Badge variant="outline" class="text-xs capitalize">{m.status.replace('_', ' ')}</Badge>
                  <span class="text-sm font-medium">{m.title}</span>
                </div>
                <Button variant="ghost" size="sm" onclick={() => deleteMaintenance(m.id)}>
                  <Trash2 class="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
              {#if m.description}
                <p class="text-xs text-muted-foreground mt-1">{m.description}</p>
              {/if}
              <p class="text-xs text-muted-foreground mt-1">
                {new Date(m.scheduledStart).toLocaleString('en-US')} - {new Date(m.scheduledEnd).toLocaleString('en-US')}
              </p>
              {#if m.autoUpdateStatus}
                <p class="text-xs text-muted-foreground mt-0.5">Monitor alerts suppressed</p>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
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
