<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { currentOrganization } from '$lib/stores/organization';
  import { monitoringStore, monitors, monitorsLoading, monitorsError } from '$lib/stores/monitoring';
  import { toastStore } from '$lib/stores/toast';
  import { layoutStore } from '$lib/stores/layout';
  import { type CreateMonitorInput, type Monitor, type MonitorType } from '$lib/api/monitoring';
  import { ProjectsAPI } from '$lib/api/projects';
  import { getAuthToken } from '$lib/utils/auth';
  import { getApiBaseUrl } from '$lib/config';
  import { logsAPI } from '$lib/api/logs';
  import type { Project } from '@logtide/shared';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import StatusBadgeEmbed from '$lib/components/monitoring/StatusBadgeEmbed.svelte';
  import Activity from '@lucide/svelte/icons/activity';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Code2 from '@lucide/svelte/icons/code-2';
  import Plus from '@lucide/svelte/icons/plus';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Globe from '@lucide/svelte/icons/globe';
  import Wifi from '@lucide/svelte/icons/wifi';
  import Heart from '@lucide/svelte/icons/heart';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ExternalLink from '@lucide/svelte/icons/external-link';

  const layout = $derived($layoutStore);
  const org = $derived($currentOrganization);
  const monitorList = $derived($monitors);
  const loading = $derived($monitorsLoading);
  const error = $derived($monitorsError);

  let projects = $state<Project[]>([]);
  const projectsAPI = new ProjectsAPI(getAuthToken);

  let showCreateForm = $state(false);
  let editingMonitor = $state<Monitor | null>(null);
  let deleteConfirmId = $state<string | null>(null);
  let submitting = $state(false);

  let formName = $state('');
  let formType = $state<MonitorType>('http');
  let formTarget = $state('');
  let formInterval = $state(60);
  let formTimeout = $state(10);
  let formThreshold = $state(2);
  let formGracePeriod = $state<number | null>(null);
  let formAutoResolve = $state(true);
  let formEnabled = $state(true);
  let projectId = $state<string | undefined>(undefined);
  let availableServices = $state<string[]>([]);
  let serviceSearchOpen = $state(false);

  $effect(() => {
    if (org) {
      monitoringStore.load(org.id, projectId);
      projectsAPI.getProjects(org.id).then((res) => {
        projects = res.projects;
        if (!projectId && res.projects.length > 0) {
          projectId = res.projects[0].id;
        }
      }).catch(() => {});
      if (projectId) {
        loadIncidents();
        loadMaintenances();
      }
    }
  });

  $effect(() => {
    if (formType === 'log_heartbeat' && projectId && org) {
      logsAPI.getServices({ projectId }).then((services) => {
        availableServices = services;
      }).catch(() => { availableServices = []; });
    }
  });

  function resetForm() {
    formName = '';
    formType = 'http';
    formTarget = '';
    formInterval = 60;
    formTimeout = 10;
    formThreshold = 2;
    formGracePeriod = null;
    formAutoResolve = true;
    formEnabled = true;
  }

  function openCreate() {
    resetForm();
    editingMonitor = null;
    showCreateForm = true;
  }

  function openEdit(monitor: Monitor) {
    formName = monitor.name;
    formType = monitor.type;
    formTarget = monitor.target ?? '';
    formInterval = monitor.intervalSeconds;
    formTimeout = monitor.timeoutSeconds;
    formThreshold = monitor.failureThreshold;
    formGracePeriod = monitor.gracePeriodSeconds;
    formAutoResolve = monitor.autoResolve;
    formEnabled = monitor.enabled;
    editingMonitor = monitor;
    showCreateForm = true;
  }

  function closeForm() {
    showCreateForm = false;
    editingMonitor = null;
    resetForm();
  }

  let formError = $state<string | null>(null);

  function validateForm(): string | null {
    if (formType === 'log_heartbeat') {
      if (!formTarget || !formTarget.trim()) {
        return 'Service name is required for log-based monitors';
      }
    }
    if (!editingMonitor) {
      if (formType === 'http') {
        if (!formTarget || !(formTarget.startsWith('http://') || formTarget.startsWith('https://'))) {
          return 'HTTP target must start with http:// or https://';
        }
      }
      if (formType === 'tcp') {
        if (!formTarget || !formTarget.includes(':')) {
          return 'TCP target must be in host:port format';
        }
      }
    }
    return null;
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!org) return;

    const validationError = validateForm();
    if (validationError) {
      formError = validationError;
      return;
    }
    formError = null;

    submitting = true;
    try {
      if (editingMonitor) {
        await monitoringStore.update(editingMonitor.id, org.id, {
          name: formName,
          target: formTarget || null,
          intervalSeconds: formInterval,
          timeoutSeconds: formTimeout,
          gracePeriodSeconds: formType === 'log_heartbeat' ? formGracePeriod : null,
          failureThreshold: formThreshold,
          autoResolve: formAutoResolve,
          enabled: formEnabled,
        });
        toastStore.success('Monitor updated');
      } else {
        const input: CreateMonitorInput = {
          organizationId: org.id,
          projectId: projectId!,
          name: formName,
          type: formType,
          target: formTarget || null,
          intervalSeconds: formInterval,
          timeoutSeconds: formTimeout,
          gracePeriodSeconds: formType === 'log_heartbeat' ? formGracePeriod : null,
          failureThreshold: formThreshold,
          autoResolve: formAutoResolve,
          enabled: formEnabled,
        };
        await monitoringStore.create(input);
        toastStore.success('Monitor created');
      }
      closeForm();
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Failed to save monitor');
    } finally {
      submitting = false;
    }
  }

  async function handleDelete(id: string) {
    if (!org) return;
    try {
      await monitoringStore.delete(id, org.id);
      toastStore.success('Monitor deleted');
      deleteConfirmId = null;
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Failed to delete monitor');
    }
  }

  function statusColor(status?: string) {
    if (status === 'up') return 'bg-green-500';
    if (status === 'down') return 'bg-red-500';
    return 'bg-gray-400';
  }

  function statusLabel(status?: string) {
    if (status === 'up') return 'Up';
    if (status === 'down') return 'Down';
    return 'Unknown';
  }

  function typeIcon(type: string) {
    if (type === 'http') return Globe;
    if (type === 'tcp') return Wifi;
    if (type === 'log_heartbeat') return Activity;
    return Heart;
  }

  function formatResponseTime(ms: number | null | undefined) {
    if (ms == null) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
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
  let showIncidentForm = $state(false);
  let incidentTitle = $state('');
  let incidentSeverity = $state('minor');
  let incidentMessage = $state('');
  let submittingIncident = $state(false);

  let showUpdateForm = $state<string | null>(null);
  let updateStatus = $state('investigating');
  let updateMessage = $state('');
  let submittingUpdate = $state(false);

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
    try {
      const res = await apiRequest(`/status-incidents?organizationId=${org.id}&projectId=${projectId}`);
      if (res.ok) {
        const data = await res.json();
        statusIncidents = data.incidents;
      }
    } catch {}
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
    try {
      const res = await apiRequest(`/maintenances?organizationId=${org.id}&projectId=${projectId}`);
      if (res.ok) {
        const data = await res.json();
        maintenances = data.maintenances;
      }
    } catch {}
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

<div class="flex flex-col gap-6 p-6">
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-3">
      <Activity class="h-6 w-6 text-primary" />
      <div>
        <h1 class="text-2xl font-semibold">Monitoring</h1>
        <p class="text-sm text-muted-foreground">Uptime and health checks for your services</p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      {#if projects.length > 1}
        <select
          bind:value={projectId}
          class="h-8 rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {#each projects as p (p.id)}
            <option value={p.id}>{p.name}</option>
          {/each}
        </select>
      {/if}
      <Button
        variant="outline"
        size="sm"
        onclick={() => org && monitoringStore.load(org.id, projectId)}
      >
        <RefreshCw class="h-4 w-4" />
      </Button>
      <Button size="sm" onclick={openCreate}>
        <Plus class="mr-2 h-4 w-4" />
        New Monitor
      </Button>
    </div>
  </div>

  {#if selectedProject}
    <div class="rounded-lg border bg-card px-4 py-3 space-y-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <label class="text-sm font-medium">Status page</label>
          <select
            value={selectedProject.statusPageVisibility}
            onchange={(e) => updateVisibility((e.target as HTMLSelectElement).value)}
            disabled={savingVisibility}
            class="h-8 rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="disabled">Disabled</option>
            <option value="public">Public</option>
            <option value="password">Password protected</option>
            <option value="members_only">Members only</option>
          </select>
          {#if selectedProject.statusPageVisibility !== 'disabled'}
            <Badge variant="outline" class="text-xs">
              {selectedProject.statusPageVisibility === 'public' ? 'Live' : selectedProject.statusPageVisibility === 'password' ? 'Protected' : 'Private'}
            </Badge>
          {/if}
        </div>
        {#if selectedProject.statusPageVisibility !== 'disabled' && selectedProject.slug}
          <a
            href="/status/{selectedProject.slug}"
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
              <StatusBadgeEmbed projectSlug={selectedProject.slug} />
            </Collapsible.Content>
          </Collapsible.Root>
        </div>
      {/if}
    </div>
  {/if}

  {#if error}
    <div class="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
      {error}
    </div>
  {/if}

  {#if showCreateForm}
    <div class="rounded-lg border bg-card p-6">
      <h2 class="mb-4 text-lg font-medium">{editingMonitor ? 'Edit Monitor' : 'New Monitor'}</h2>
      <form onsubmit={handleSubmit} class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="sm:col-span-2">
          <label class="mb-1 block text-sm font-medium">Name</label>
          <input
            bind:value={formName}
            required
            minlength="1"
            maxlength="255"
            class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="My API"
          />
        </div>

        {#if !editingMonitor}
          <div>
            <label class="mb-1 block text-sm font-medium">Project</label>
            <select
              bind:value={projectId}
              required
              class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {#each projects as p (p.id)}
                <option value={p.id}>{p.name}</option>
              {/each}
            </select>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium">Type</label>
            <select
              bind:value={formType}
              class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="http">HTTP / HTTPS</option>
              <option value="tcp">TCP</option>
              <option value="heartbeat">Heartbeat (Push)</option>
              <option value="log_heartbeat">Log Based</option>
            </select>
          </div>
        {/if}

        {#if formType === 'log_heartbeat'}
          <div class={!editingMonitor ? '' : 'sm:col-span-2'}>
            <label class="mb-1 block text-sm font-medium">Service name</label>
            <div class="relative">
              <input
                bind:value={formTarget}
                onfocus={() => { serviceSearchOpen = true; }}
                onblur={() => { setTimeout(() => { serviceSearchOpen = false; }, 150); }}
                class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. logtide-worker"
              />
              {#if serviceSearchOpen && availableServices.length > 0}
                <div class="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-40 overflow-y-auto">
                  {#each availableServices.filter((s) => !formTarget || s.toLowerCase().includes(formTarget.toLowerCase())) as svc (svc)}
                    <button
                      type="button"
                      class="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                      onmousedown={() => { formTarget = svc; serviceSearchOpen = false; }}
                    >
                      {svc}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
            <p class="mt-1 text-xs text-muted-foreground">Monitor checks if this service sent logs recently</p>
          </div>
        {:else if formType === 'heartbeat'}
          <div class="sm:col-span-2">
            <div class="rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950 px-3 py-2 text-sm text-blue-800 dark:text-blue-200">
              <p class="font-medium mb-1">Push-based heartbeat</p>
              <p class="text-xs">After creating this monitor, you'll get an endpoint URL. Your service must send periodic POST requests to it.</p>
            </div>
          </div>
        {:else}
          <div class={!editingMonitor ? '' : 'sm:col-span-2'}>
            <label class="mb-1 block text-sm font-medium">
              {formType === 'tcp' ? 'Target (host:port)' : 'URL'}
            </label>
            <input
              bind:value={formTarget}
              class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder={formType === 'tcp' ? 'db.example.com:5432' : 'https://example.com/health'}
            />
          </div>
        {/if}

        <div>
          <label class="mb-1 block text-sm font-medium">Check interval (seconds)</label>
          <input
            type="number"
            bind:value={formInterval}
            min="30"
            max="86400"
            class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {#if formType !== 'heartbeat' && formType !== 'log_heartbeat'}
          <div>
            <label class="mb-1 block text-sm font-medium">Timeout (seconds)</label>
            <input
              type="number"
              bind:value={formTimeout}
              min="1"
              max="60"
              class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        {/if}

        {#if formType === 'log_heartbeat'}
          <div>
            <label class="mb-1 block text-sm font-medium">Silence threshold (seconds)</label>
            <input
              type="number"
              bind:value={formGracePeriod}
              min="60"
              max="86400"
              placeholder={String(Math.round(formInterval * 1.5))}
              class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p class="mt-1 text-xs text-muted-foreground">Mark as down after this many seconds without logs. Default: {Math.round(formInterval * 1.5)}s (interval × 1.5)</p>
          </div>
        {/if}

        <div>
          <label class="mb-1 block text-sm font-medium">Failure threshold</label>
          <input
            type="number"
            bind:value={formThreshold}
            min="1"
            max="20"
            class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <p class="mt-1 text-xs text-muted-foreground">Consecutive failures before alerting</p>
        </div>

        <div class="flex items-center gap-4">
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" bind:checked={formAutoResolve} class="rounded" />
            Auto-resolve incident on recovery
          </label>
        </div>

        <div class="flex items-center gap-4">
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" bind:checked={formEnabled} class="rounded" />
            Enabled
          </label>
        </div>

        {#if formError}
          <div class="sm:col-span-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </div>
        {/if}

        <div class="sm:col-span-2 flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onclick={closeForm}>Cancel</Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : editingMonitor ? 'Save changes' : 'Create monitor'}
          </Button>
        </div>
      </form>
    </div>
  {/if}

  {#if loading}
    <div class="flex items-center justify-center py-16">
      <RefreshCw class="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  {:else if monitorList.length === 0 && !showCreateForm}
    <div class="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-16 text-center">
      <Activity class="h-10 w-10 text-muted-foreground" />
      <div>
        <p class="font-medium">No monitors yet</p>
        <p class="text-sm text-muted-foreground">Create a monitor to track uptime and health of your services</p>
      </div>
      <Button size="sm" onclick={openCreate}>
        <Plus class="mr-2 h-4 w-4" />
        Create your first monitor
      </Button>
    </div>
  {:else}
    <div class="rounded-lg border bg-card">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <th class="px-4 py-3">Status</th>
            <th class="px-4 py-3">Name</th>
            <th class="px-4 py-3">Type</th>
            <th class="px-4 py-3 hidden md:table-cell">Response</th>
            <th class="px-4 py-3 hidden lg:table-cell">Last checked</th>
            <th class="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each monitorList as monitor (monitor.id)}
            <tr class="border-b last:border-0 hover:bg-muted/40 transition-colors">
              <td class="px-4 py-3">
                <div class="flex items-center gap-2">
                  <span class="h-2.5 w-2.5 rounded-full {statusColor(monitor.status?.status)}"></span>
                  <span class="font-medium {monitor.status?.status === 'down' ? 'text-destructive' : ''}">
                    {statusLabel(monitor.status?.status)}
                  </span>
                  {#if !monitor.enabled}
                    <Badge variant="outline" class="text-xs">Paused</Badge>
                  {/if}
                </div>
              </td>
              <td class="px-4 py-3">
                <button
                  class="font-medium hover:text-primary hover:underline text-left"
                  onclick={() => goto(`/dashboard/monitoring/${monitor.id}`)}
                >
                  {monitor.name}
                </button>
              </td>
              <td class="px-4 py-3">
                <div class="flex items-center gap-1.5 text-muted-foreground">
                  {#if monitor.type === 'http'}
                    <Globe class="h-3.5 w-3.5" />
                  {:else if monitor.type === 'tcp'}
                    <Wifi class="h-3.5 w-3.5" />
                  {:else if monitor.type === 'log_heartbeat'}
                    <Activity class="h-3.5 w-3.5" />
                  {:else}
                    <Heart class="h-3.5 w-3.5" />
                  {/if}
                  {#if monitor.type === 'http'}
                    HTTP
                  {:else if monitor.type === 'tcp'}
                    TCP
                  {:else if monitor.type === 'log_heartbeat'}
                    Log Based
                  {:else}
                    Heartbeat (Push)
                  {/if}
                </div>
              </td>
              <td class="px-4 py-3 hidden md:table-cell text-muted-foreground">
                {formatResponseTime(monitor.status?.responseTimeMs)}
              </td>
              <td class="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs">
                {monitor.status?.lastCheckedAt
                  ? new Date(monitor.status.lastCheckedAt).toLocaleString()
                  : '-'}
              </td>
              <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-1">
                  {#if deleteConfirmId === monitor.id}
                    <span class="text-xs text-muted-foreground mr-1">Delete?</span>
                    <Button
                      variant="destructive"
                      size="sm"
                      onclick={() => handleDelete(monitor.id)}
                    >Yes</Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onclick={() => (deleteConfirmId = null)}
                    >No</Button>
                  {:else}
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => openEdit(monitor)}
                      title="Edit"
                    >
                      <Pencil class="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => (deleteConfirmId = monitor.id)}
                      title="Delete"
                    >
                      <Trash2 class="h-4 w-4 text-destructive" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => goto(`/dashboard/monitoring/${monitor.id}`)}
                      title="View details"
                    >
                      <ChevronRight class="h-4 w-4" />
                    </Button>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">Status Incidents</h2>
      <Button size="sm" onclick={() => (showIncidentForm = !showIncidentForm)}>
        <Plus class="mr-2 h-4 w-4" />
        New Incident
      </Button>
    </div>

    {#if showIncidentForm}
      <div class="rounded-lg border bg-card p-4">
        <form onsubmit={createIncident} class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class="sm:col-span-2">
            <label class="mb-1 block text-sm font-medium">Title</label>
            <input bind:value={incidentTitle} required maxlength="255" placeholder="Investigating API latency issues"
              class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium">Severity</label>
            <select bind:value={incidentSeverity} class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="minor">Minor</option>
              <option value="major">Major</option>
              <option value="critical">Critical</option>
            </select>
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
      </div>
    {/if}

    {#if statusIncidents.length === 0}
      <p class="text-sm text-muted-foreground">No incidents.</p>
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
                <Button variant="ghost" size="sm" onclick={() => { showUpdateForm = showUpdateForm === incident.id ? null : incident.id; updateStatus = incident.status; }}>
                  <Pencil class="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" onclick={() => deleteIncident(incident.id)}>
                  <Trash2 class="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
            <p class="text-xs text-muted-foreground mt-1">{new Date(incident.createdAt).toLocaleString()}</p>

            {#if showUpdateForm === incident.id}
              <div class="mt-3 border-t pt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label class="mb-1 block text-xs font-medium">Status</label>
                  <select bind:value={updateStatus} class="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                    <option value="investigating">Investigating</option>
                    <option value="identified">Identified</option>
                    <option value="monitoring">Monitoring</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </div>
                <div class="sm:col-span-2">
                  <label class="mb-1 block text-xs font-medium">Message</label>
                  <textarea bind:value={updateMessage} rows="2" required maxlength="5000" placeholder="Update message..."
                    class="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"></textarea>
                </div>
                <div class="sm:col-span-2 flex justify-end gap-2">
                  <Button variant="outline" size="sm" onclick={() => (showUpdateForm = null)}>Cancel</Button>
                  <Button size="sm" disabled={submittingUpdate || !updateMessage} onclick={() => addIncidentUpdate(incident.id)}>
                    {submittingUpdate ? 'Posting...' : 'Post update'}
                  </Button>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">Scheduled Maintenance</h2>
      <Button size="sm" onclick={() => (showMaintenanceForm = !showMaintenanceForm)}>
        <Plus class="mr-2 h-4 w-4" />
        Schedule Maintenance
      </Button>
    </div>

    {#if showMaintenanceForm}
      <div class="rounded-lg border bg-card p-4">
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
      </div>
    {/if}

    {#if maintenances.length === 0}
      <p class="text-sm text-muted-foreground">No scheduled maintenances.</p>
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
              {new Date(m.scheduledStart).toLocaleString()} - {new Date(m.scheduledEnd).toLocaleString()}
            </p>
            {#if m.autoUpdateStatus}
              <p class="text-xs text-muted-foreground mt-0.5">Monitor alerts suppressed</p>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
