<!--
  Host and service pages of Metrics (shared body of both routes).

  Props:
    kind   'host' | 'service'
    name   host.name / service.name

  Header (status, reason, info, actions), tabs in the URL (?tab=), and the
  tab bodies. Resources/Overview render the kind template through
  SourceTemplateView; Hardware embeds the hardware host panel.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import {
    HOST_THRESHOLDS,
    SERVICE_ERROR_THRESHOLDS,
    formatMetricValue,
    type HostSourceDetail,
    type MetricSourceKind,
    type ServiceSourceDetail,
    type SourceSignalValue,
  } from '@logtide/shared';
  import { currentOrganization } from '$lib/stores/organization';
  import { scopeStore, resolveRange } from '$lib/stores/scope';
  import { layoutStore } from '$lib/stores/layout';
  import { toastStore } from '$lib/stores/toast';
  import { startVisiblePolling } from '$lib/utils/visible-polling';
  import { ProjectsAPI } from '$lib/api/projects';
  import { metricsV2API } from '$lib/api/metrics-v2';
  import { getAuthToken } from '$lib/utils/auth';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import ScopeBar from '$lib/components/app/ScopeBar.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import MetricsSubNav from '$lib/components/metrics/v2/MetricsSubNav.svelte';
  import SourceStatusDot from '$lib/components/metrics/v2/SourceStatusDot.svelte';
  import HardwareHostPanel from '$lib/components/hardware/HardwareHostPanel.svelte';
  import HardwareSetup from '$lib/components/hardware/HardwareSetup.svelte';
  import SourceTemplateView from './SourceTemplateView.svelte';
  import SourceMetricsGrid from './SourceMetricsGrid.svelte';
  import SourceRelatedList from './SourceRelatedList.svelte';
  import SourceLogsTab from './SourceLogsTab.svelte';
  import { buildExploreHref, buildServiceTracesHref, buildSourceLogsHref } from './source-model';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
  import ExternalLink from '@lucide/svelte/icons/external-link';

  interface Props {
    kind: MetricSourceKind;
    name: string;
  }

  let { kind, name }: Props = $props();

  const REFRESH_MS = 60_000;

  type TabId = 'resources' | 'overview' | 'hardware' | 'services' | 'hosts' | 'logs' | 'traces' | 'metrics';

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

  const org = $derived($currentOrganization);
  const projectsAPI = new ProjectsAPI(getAuthToken);

  let projects = $state<{ id: string; name: string }[]>([]);
  let projectsLoaded = $state(false);

  $effect(() => {
    const orgId = org?.id;
    if (!orgId) return;
    let cancelled = false;
    projectsLoaded = false;
    projectsAPI
      .getProjects(orgId)
      .then((res) => {
        if (cancelled) return;
        projects = res.projects.map((p) => ({ id: p.id, name: p.name }));
        projectsLoaded = true;
      })
      .catch(() => {
        if (cancelled) return;
        projects = [];
        projectsLoaded = true;
      });
    return () => {
      cancelled = true;
    };
  });

  const projectNames = $derived(Object.fromEntries(projects.map((p) => [p.id, p.name])));

  const scopeProjectIds = $derived.by(() => {
    const known = new Set(projects.map((p) => p.id));
    const ids = $scopeStore.projectIds.filter((id) => known.has(id));
    return ids.length > 0 ? ids : null;
  });
  const scopeKey = $derived(JSON.stringify([org?.id, kind, name, scopeProjectIds, $scopeStore.range]));

  let detail = $state<HostSourceDetail | ServiceSourceDetail | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let win = $state<{ from: string; to: string }>({ from: '', to: '' });

  let seq = 0;

  async function load(silent: boolean) {
    const organizationId = org?.id;
    if (!organizationId) return;
    const mine = ++seq;
    if (!silent) loading = true;
    const { from, to } = resolveRange($scopeStore.range);
    const params = { organizationId, projectIds: scopeProjectIds, from: from.toISOString(), to: to.toISOString() };
    try {
      const res = kind === 'host' ? await metricsV2API.getHostSource(name, params) : await metricsV2API.getServiceSource(name, params);
      if (mine !== seq) return;
      detail = res;
      win = { from: params.from, to: params.to };
      error = null;
    } catch (err) {
      if (mine !== seq) return;
      error = err instanceof Error ? err.message : 'Could not load this source';
      if (!silent) detail = null;
    } finally {
      if (mine === seq) loading = false;
    }
  }

  $effect(() => {
    scopeKey;
    if (!projectsLoaded || !org) return;
    untrack(() => {
      detail = null;
      void load(false);
    });
    const stop = startVisiblePolling(() => void load(true), REFRESH_MS);
    return () => {
      stop();
      seq++;
    };
  });

  const host = $derived(detail?.kind === 'host' ? detail : null);
  const service = $derived(detail?.kind === 'service' ? detail : null);
  const effectiveProjectIds = $derived(scopeProjectIds);
  const detailProjectIds = $derived(detail?.projectIds ?? []);

  // ---- tabs (URL) ----------------------------------------------------------

  const tabs = $derived.by((): { id: TabId; label: string }[] => {
    if (kind === 'host') {
      return [
        { id: 'resources', label: 'Resources' },
        { id: 'hardware', label: 'Hardware' },
        { id: 'services', label: `Services${host ? ` (${host.services.length})` : ''}` },
        { id: 'logs', label: 'Logs' },
        { id: 'traces', label: 'Traces' },
        { id: 'metrics', label: `Metrics${detail ? ` (${detail.metricNames.length})` : ''}` },
      ];
    }
    return [
      { id: 'overview', label: 'Overview' },
      { id: 'hosts', label: `Hosts${service ? ` (${service.hosts.length})` : ''}` },
      { id: 'logs', label: 'Logs' },
      { id: 'traces', label: 'Traces' },
      { id: 'metrics', label: `Metrics${detail ? ` (${detail.metricNames.length})` : ''}` },
    ];
  });

  const activeTab = $derived.by((): TabId => {
    const wanted = page.url.searchParams.get('tab');
    const found = tabs.find((t) => t.id === wanted);
    return found ? found.id : tabs[0].id;
  });

  function setTab(id: TabId) {
    const url = new URL(page.url);
    if (id === tabs[0].id) url.searchParams.delete('tab');
    else url.searchParams.set('tab', id);
    void goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

  // ---- header ----------------------------------------------------------------

  function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    if (days >= 1) return `${days.toLocaleString('en-US')} ${days === 1 ? 'day' : 'days'}`;
    const hours = Math.floor(seconds / 3600);
    if (hours >= 1) return `${hours} h`;
    return `${Math.max(1, Math.floor(seconds / 60))} min`;
  }

  const infoLine = $derived.by(() => {
    if (!detail) return '';
    const parts: string[] = [];
    if (host) {
      const i = host.info;
      const os = i.os ?? host.os;
      if (os) parts.push(i.kernel && !os.includes(i.kernel) ? `${os} (${i.kernel})` : os);
      else if (i.kernel) parts.push(i.kernel);
      if (i.cpuCount) parts.push(`${i.cpuCount} vCPU`);
      if (i.memoryBytes) parts.push(formatMetricValue(i.memoryBytes, 'By'));
      if (i.uptimeSeconds) parts.push(`uptime ${formatUptime(i.uptimeSeconds)}`);
      if (i.agentVersion) parts.push(`agent ${i.agentVersion}`);
    }
    const names = detail.projectIds.map((id) => projectNames[id] ?? id);
    if (names.length > 0) parts.push(`${names.length === 1 ? 'project' : 'projects'} ${names.join(', ')}`);
    return parts.join(' · ');
  });

  const exploreHref = $derived(
    buildExploreHref(kind, name, detail?.metricNames ?? [], effectiveProjectIds ?? (detail ? detail.projectIds : null)),
  );
  const logsHref = $derived(buildSourceLogsHref(kind, name, { projectIds: $scopeStore.projectIds, range: $scopeStore.range }));

  let customizing = $state(false);

  async function customize() {
    if (!org || customizing) return;
    customizing = true;
    try {
      const res = await metricsV2API.customizeSource(kind, name, {
        organizationId: org.id,
        projectIds: effectiveProjectIds,
      });
      await goto(`/dashboard?id=${encodeURIComponent(res.dashboardId)}`);
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Could not create the dashboard');
    } finally {
      customizing = false;
    }
  }

  // ---- hardware tab ----------------------------------------------------------

  let selectedHardwareId = $state<string | null>(null);
  const hardwareHosts = $derived(host?.hardwareHosts ?? []);
  const hardwareId = $derived.by(() => {
    const byUser = hardwareHosts.find((h) => h.id === selectedHardwareId);
    if (byUser) return byUser.id;
    const wantedProject = page.url.searchParams.get('project');
    return (hardwareHosts.find((h) => h.projectId === wantedProject) ?? hardwareHosts[0])?.id ?? null;
  });

  // ---- kpis ------------------------------------------------------------------

  interface Kpi {
    id: string;
    label: string;
    value: string;
    hint?: string;
    tone?: 'ok' | 'warning' | 'critical';
  }

  function percentTone(v: number | null, t: { warning: number; critical: number }): Kpi['tone'] {
    if (v === null) return undefined;
    return v >= t.critical ? 'critical' : v >= t.warning ? 'warning' : undefined;
  }

  function fmt(s: SourceSignalValue): string {
    return s.value === null ? 'n/a' : formatMetricValue(s.value, s.unit);
  }

  const kpis = $derived.by((): Kpi[] => {
    if (host) {
      return [
        { id: 'cpu', label: 'CPU', value: fmt(host.cpu), tone: percentTone(host.cpu.value, HOST_THRESHOLDS.cpu), hint: host.info.cpuCount ? `${host.info.cpuCount} vCPU` : undefined },
        { id: 'memory', label: 'Memory', value: fmt(host.memory), tone: percentTone(host.memory.value, HOST_THRESHOLDS.memory), hint: host.info.memoryBytes ? formatMetricValue(host.info.memoryBytes, 'By') : undefined },
        { id: 'load', label: 'Load 5m', value: fmt(host.load), hint: host.info.cpuCount ? `${host.info.cpuCount} cores` : undefined },
        { id: 'disk', label: 'Fullest disk', value: fmt(host.disk), tone: percentTone(host.disk.value, HOST_THRESHOLDS.disk) },
        { id: 'network', label: 'Network', value: fmt(host.network) },
      ];
    }
    if (service) {
      return [
        { id: 'rate', label: 'Requests', value: service.hasTraces ? fmt(service.requestRate) : 'n/a' },
        { id: 'errors', label: 'Errors', value: service.hasTraces ? fmt(service.errorRate) : 'n/a', tone: service.hasTraces ? percentTone(service.errorRate.value, SERVICE_ERROR_THRESHOLDS) : undefined },
        { id: 'p95', label: 'p95 latency', value: service.hasTraces ? fmt(service.p95) : 'n/a' },
        { id: 'hosts', label: 'Hosts', value: String(service.hosts.length) },
        { id: 'metrics', label: 'Metrics', value: service.metricCount.toLocaleString('en-US') },
      ];
    }
    return [];
  });

  const TONE_TEXT = { ok: '', warning: 'text-warning-text', critical: 'text-destructive-text' } as const;

  const crumbKind = $derived(kind === 'host' ? 'Hosts' : 'Services');
  const title = $derived(name);
</script>

<svelte:head>
  <title>{title} - Metrics - LogTide</title>
</svelte:head>

<div class="container mx-auto flex flex-col gap-4 {containerPadding} {maxWidthClass}">
  <PageHeader
    {title}
    description={infoLine}
    breadcrumbs={[
      { label: 'Metrics', href: '/dashboard/metrics' },
      { label: crumbKind, href: `/dashboard/metrics?kind=${kind}` },
      { label: name },
    ]}
  >
    {#snippet meta()}
      {#if detail}
        <SourceStatusDot status={detail.status} reason={detail.statusReason} showLabel />
        {#if detail.statusReason && detail.status !== 'ok'}
          <Badge variant="outline" class="font-normal" data-testid="status-reason">{detail.statusReason}</Badge>
        {/if}
      {/if}
    {/snippet}
    {#snippet actions()}
      <ScopeBar mode="multi" {projects} />
      <Button variant="outline" size="sm" href={exploreHref}>
        <ExternalLink class="mr-2 h-4 w-4" aria-hidden="true" />
        Open in Explore
      </Button>
      <Button size="sm" onclick={customize} disabled={customizing || !detail}>
        <LayoutDashboard class="mr-2 h-4 w-4" aria-hidden="true" />
        Customize
      </Button>
      <Button variant="outline" size="sm" onclick={() => void load(false)} aria-label="Refresh">
        <RefreshCw class="h-4 w-4" />
      </Button>
    {/snippet}
  </PageHeader>

  <MetricsSubNav />

  {#if !projectsLoaded || (loading && !detail)}
    <div class="py-16 text-center text-sm text-muted-foreground" role="status">Loading {kind}</div>
  {:else if error && !detail}
    <EmptyState variant="error" title="Could not load this {kind}" description={error}>
      {#snippet actions()}
        <Button variant="outline" size="sm" onclick={() => void load(false)}>Try again</Button>
        <Button variant="ghost" size="sm" href="/dashboard/metrics?kind={kind}">Back to {crumbKind.toLowerCase()}</Button>
      {/snippet}
    </EmptyState>
  {:else if detail && org}
    <div class="flex gap-5 overflow-x-auto border-b border-border" role="tablist" aria-label="{kind === 'host' ? 'Host' : 'Service'} views">
      {#each tabs as tab (tab.id)}
        <button
          type="button"
          role="tab"
          id="source-tab-{tab.id}"
          aria-selected={activeTab === tab.id}
          aria-controls="source-panel"
          class="-mb-px whitespace-nowrap border-b-2 px-0.5 pb-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {activeTab === tab.id
            ? 'border-primary font-medium text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'}"
          onclick={() => setTab(tab.id)}
        >
          {tab.label}
        </button>
      {/each}
    </div>

    <div id="source-panel" role="tabpanel" aria-labelledby="source-tab-{activeTab}" class="space-y-4">
      {#if activeTab === 'resources' || activeTab === 'overview'}
        <div class="grid grid-cols-2 gap-2 md:grid-cols-5" data-testid="kpis">
          {#each kpis as kpi (kpi.id)}
            <div class="rounded-lg border bg-card px-3 py-2" data-testid="kpi-{kpi.id}">
              <p class="text-xs text-muted-foreground">{kpi.label}</p>
              <p class="mt-0.5 text-lg font-semibold tabular-nums {TONE_TEXT[kpi.tone ?? 'ok']}">{kpi.value}</p>
              {#if kpi.hint}<p class="text-xs text-muted-foreground">{kpi.hint}</p>{/if}
            </div>
          {/each}
        </div>
        <SourceTemplateView
          {kind}
          {name}
          metricNames={detail.metricNames}
          organizationId={org.id}
          projectIds={effectiveProjectIds}
          from={win.from}
          to={win.to}
        />
      {:else if activeTab === 'hardware' && host}
        {#if hardwareHosts.length === 0}
          <div class="space-y-3" data-testid="hardware-empty">
            <EmptyState
              variant="setup"
              title="No hardware data for this host"
              description="Run the LogTide hardware agent on this host to see disks, sensors, power and network health here."
            />
            <HardwareSetup projectId={detail.projectIds[0]} />
          </div>
        {:else}
          {#if hardwareHosts.length > 1}
            <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Project">
              {#each hardwareHosts as hw (hw.id)}
                <button
                  type="button"
                  class="rounded-full px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {hardwareId === hw.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'}"
                  aria-pressed={hardwareId === hw.id}
                  onclick={() => (selectedHardwareId = hw.id)}
                >
                  {projectNames[hw.projectId] ?? hw.projectId}
                </button>
              {/each}
            </div>
          {/if}
          {#if hardwareId}
            {#key hardwareId}
              <HardwareHostPanel hostId={hardwareId} onForgotten={() => { setTab('resources'); void load(false); }} />
            {/key}
          {/if}
        {/if}
      {:else if activeTab === 'services' && host}
        <SourceRelatedList
          listKind="service"
          names={host.services}
          organizationId={org.id}
          projectIds={effectiveProjectIds}
          from={win.from}
          to={win.to}
        />
      {:else if activeTab === 'hosts' && service}
        <SourceRelatedList
          listKind="host"
          names={service.hosts}
          organizationId={org.id}
          projectIds={effectiveProjectIds}
          from={win.from}
          to={win.to}
        />
      {:else if activeTab === 'logs'}
        <SourceLogsTab {kind} {name} projectIds={detailProjectIds} from={win.from} to={win.to} {logsHref} />
      {:else if activeTab === 'traces'}
        <section class="rounded-lg border bg-card" data-testid="source-traces">
          {#if service}
            <div class="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <h3 class="text-sm font-medium">Traces</h3>
                <p class="text-sm text-muted-foreground">
                  {service.hasTraces ? 'Open the traces of this service for the selected time range.' : 'This service sent no traces in this window. Instrument it with OpenTelemetry tracing to see them.'}
                </p>
              </div>
              <Button size="sm" variant="outline" href={buildServiceTracesHref(name, { projectIds: $scopeStore.projectIds, range: $scopeStore.range })}>
                Open in Traces
              </Button>
            </div>
          {:else if host}
            <div class="px-4 py-3">
              <h3 class="text-sm font-medium">Traces of the services on this host</h3>
              {#if host.services.length === 0}
                <p class="mt-1 text-sm text-muted-foreground">No services are linked to this host yet.</p>
              {:else}
                <ul class="mt-2 divide-y">
                  {#each host.services as s (s)}
                    <li class="flex items-center justify-between gap-2 py-2">
                      <span class="font-medium">{s}</span>
                      <Button size="sm" variant="outline" href={buildServiceTracesHref(s, { projectIds: $scopeStore.projectIds, range: $scopeStore.range })} aria-label="Open traces of {s}">
                        Open in Traces
                      </Button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}
        </section>
      {:else if activeTab === 'metrics'}
        <SourceMetricsGrid
          {kind}
          {name}
          metricNames={detail.metricNames}
          organizationId={org.id}
          projectIds={effectiveProjectIds}
          from={win.from}
          to={win.to}
        />
      {/if}
    </div>
  {/if}
</div>
