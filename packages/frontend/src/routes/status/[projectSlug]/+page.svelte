<script lang="ts">
  import { onMount } from 'svelte';
  import { getApiUrl } from '$lib/config';
  import { page } from '$app/stores';
  import { themeStore } from '$lib/stores/theme';
  import { getAuthToken } from '$lib/utils/auth';

  const theme = $derived($themeStore);

  interface UptimeBar {
    bucket: string;
    uptimePct: number | string;
  }

  interface MonitorStatus {
    name: string;
    type: string;
    status: 'up' | 'down' | 'unknown';
    uptimeHistory: UptimeBar[];
  }

  interface StatusIncident {
    id: string;
    title: string;
    status: string;
    severity: string;
    createdAt: string;
    resolvedAt: string | null;
    updates: { id: string; status: string; message: string; createdAt: string }[];
  }

  interface StatusMaintenance {
    id: string;
    title: string;
    description: string | null;
    status: string;
    scheduledStart: string;
    scheduledEnd: string;
  }

  interface StatusPageData {
    projectName: string;
    projectSlug: string;
    overallStatus: 'operational' | 'degraded' | 'outage';
    monitors: MonitorStatus[];
    activeIncidents: StatusIncident[];
    recentIncidents: StatusIncident[];
    activeMaintenances: StatusMaintenance[];
    upcomingMaintenances: StatusMaintenance[];
    lastUpdated: string;
  }

  let data = $state<StatusPageData | null>(null);
  let loading = $state(true);
  let notFound = $state(false);
  let fetchError = $state<string | null>(null);


  let requiresPassword = $state(false);
  let requiresAuth = $state(false);
  let passwordInput = $state('');
  let passwordError = $state<string | null>(null);

  function getStoredPassword(): string | null {
    try {
      return sessionStorage.getItem(`status-pw-${$page.params.projectSlug}`);
    } catch { return null; }
  }

  function storePassword(pw: string) {
    try { sessionStorage.setItem(`status-pw-${$page.params.projectSlug}`, pw); } catch {}
  }

  let pendingPassword = $state<string | null>(null);

  async function load() {
    const slug = $page.params.projectSlug;
    if (!slug) return;
    loading = true;
    fetchError = null;
    notFound = false;

    const headers: Record<string, string> = {};
    const pw = pendingPassword ?? getStoredPassword();
    if (pw) headers['X-Status-Password'] = pw;
    const token = getAuthToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(`${getApiUrl()}/api/v1/status/project/${slug}`, { headers });
      if (res.status === 404) {
        notFound = true;
        return;
      }
      if (res.status === 401) {
        const body = await res.json();
        if (body.requiresPassword) {
          requiresPassword = true;
          requiresAuth = false;
          if (pw) {
            passwordError = 'Invalid password';
            pendingPassword = null;
            try { sessionStorage.removeItem(`status-pw-${slug}`); } catch {}
          }
          return;
        }
        if (body.requiresAuth) {
          requiresAuth = true;
          requiresPassword = false;
          return;
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      requiresPassword = false;
      requiresAuth = false;
      if (pw) storePassword(pw);
      pendingPassword = null;
      data = await res.json();
    } catch (err) {
      fetchError = err instanceof Error ? err.message : 'Failed to load status';
    } finally {
      loading = false;
    }
  }

  async function submitPassword() {
    if (!passwordInput) return;
    passwordError = null;
    pendingPassword = passwordInput;
    await load();
  }

  onMount(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  });

  function pct(v: number | string): number {
    return typeof v === 'string' ? parseFloat(v) : v;
  }

  function barColor(val: number | string) {
    const p = pct(val);
    if (p >= 99) return 'bg-green-500';
    if (p >= 95) return 'bg-yellow-400';
    if (p > 0) return 'bg-red-500';
    return 'bg-muted';
  }

  function badgeColor(val: number | string) {
    const p = pct(val);
    if (p >= 99) return 'bg-green-500/15 text-green-700 dark:text-green-400 ring-green-500/20';
    if (p >= 95) return 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 ring-yellow-500/20';
    return 'bg-red-500/15 text-red-700 dark:text-red-400 ring-red-500/20';
  }

  function statusDot(s: string) {
    if (s === 'up') return 'bg-green-500 shadow-green-500/50';
    if (s === 'down') return 'bg-red-500 shadow-red-500/50';
    return 'bg-muted-foreground';
  }

  function avgUptime(history: UptimeBar[]): number | null {
    if (history.length === 0) return null;
    return history.reduce((sum, b) => sum + pct(b.uptimePct), 0) / history.length;
  }

  function overallBanner(s: string) {
    if (s === 'operational') return { bg: 'bg-green-500/10 border-green-500/20', text: 'text-green-700 dark:text-green-400', dot: 'bg-green-500 shadow-green-500/50', label: 'All systems operational' };
    if (s === 'degraded') return { bg: 'bg-yellow-500/10 border-yellow-500/20', text: 'text-yellow-700 dark:text-yellow-400', dot: 'bg-yellow-400 shadow-yellow-400/50', label: 'Partial system outage' };
    return { bg: 'bg-red-500/10 border-red-500/20', text: 'text-red-700 dark:text-red-400', dot: 'bg-red-500 shadow-red-500/50', label: 'Major system outage' };
  }

  function getMonitorTypeLabel(type: string): string {
    if (type === 'http') return 'HTTP';
    if (type === 'tcp') return 'TCP';
    if (type === 'log_heartbeat') return 'Log Based';
    return 'Heartbeat';
  }
</script>

<svelte:head>
  <title>{data?.projectName ?? $page.params.projectSlug} - Status</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
  {#if loading}
    <div class="flex items-center justify-center py-32">
      <div class="h-8 w-8 animate-spin rounded-full border-[3px] border-muted border-t-primary"></div>
    </div>
  {:else if requiresPassword}
    <div class="text-center py-32">
      <div class="inline-flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </div>
      <h1 class="text-xl font-semibold mb-2">Password required</h1>
      <p class="text-sm text-muted-foreground mb-4">This status page is password protected.</p>
      <form onsubmit={(e) => { e.preventDefault(); submitPassword(); }} class="inline-flex flex-col items-center gap-3">
        <input
          type="password"
          bind:value={passwordInput}
          placeholder="Enter password"
          class="h-10 w-64 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary text-center"
          autofocus
        />
        {#if passwordError}
          <p class="text-xs text-destructive">{passwordError}</p>
        {/if}
        <button type="submit" class="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
          View status
        </button>
      </form>
    </div>
  {:else if requiresAuth}
    <div class="text-center py-32">
      <div class="inline-flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      </div>
      <h1 class="text-xl font-semibold mb-2">Login required</h1>
      <p class="text-sm text-muted-foreground mb-4">This status page is only available to organization members.</p>
      <a href="/login" class="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
        Log in
      </a>
    </div>
  {:else if notFound}
    <div class="text-center py-32">
      <div class="inline-flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
        <span class="text-2xl">?</span>
      </div>
      <h1 class="text-xl font-semibold mb-2">Status page not found</h1>
      <p class="text-sm text-muted-foreground">The project <code class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{$page.params.projectSlug}</code> does not have a public status page.</p>
    </div>
  {:else if fetchError}
    <div class="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive text-center">
      {fetchError}
    </div>
  {:else if data}
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold tracking-tight">{data.projectName}</h1>
        <p class="text-xs text-muted-foreground mt-0.5">Service status</p>
      </div>
      <button
        onclick={() => themeStore.toggle()}
        class="h-8 w-8 rounded-md border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title="Toggle theme"
      >
        {#if theme === 'dark'}
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        {/if}
      </button>
    </div>

    <div class="rounded-lg border {overallBanner(data.overallStatus).bg} px-4 py-3 mb-6 flex items-center gap-3">
      <span class="h-3 w-3 rounded-full {overallBanner(data.overallStatus).dot} shadow-sm animate-pulse"></span>
      <span class="text-sm font-semibold {overallBanner(data.overallStatus).text}">{overallBanner(data.overallStatus).label}</span>
    </div>

    {#if data.activeMaintenances.length > 0 || data.upcomingMaintenances.length > 0}
      <div class="space-y-2 mb-6">
        {#each data.activeMaintenances as m (m.id)}
          <div class="rounded-lg border border-blue-500/20 bg-blue-500/10 px-4 py-3">
            <div class="flex items-center gap-2 mb-1">
              <span class="h-2 w-2 rounded-full bg-blue-500 animate-pulse"></span>
              <span class="text-sm font-semibold text-blue-700 dark:text-blue-400">Maintenance in progress</span>
            </div>
            <p class="text-sm font-medium">{m.title}</p>
            {#if m.description}
              <p class="text-xs text-muted-foreground mt-0.5">{m.description}</p>
            {/if}
            <p class="text-xs text-muted-foreground mt-1">
              {new Date(m.scheduledStart).toLocaleString()} - {new Date(m.scheduledEnd).toLocaleString()}
            </p>
          </div>
        {/each}
        {#each data.upcomingMaintenances as m (m.id)}
          <div class="rounded-lg border border-blue-500/15 bg-blue-500/5 px-4 py-3">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-500/15 px-2 py-0.5 rounded-full">Scheduled</span>
            </div>
            <p class="text-sm font-medium">{m.title}</p>
            {#if m.description}
              <p class="text-xs text-muted-foreground mt-0.5">{m.description}</p>
            {/if}
            <p class="text-xs text-muted-foreground mt-1">
              {new Date(m.scheduledStart).toLocaleString()} - {new Date(m.scheduledEnd).toLocaleString()}
            </p>
          </div>
        {/each}
      </div>
    {/if}

    {#if data.activeIncidents.length > 0}
      <div class="space-y-3 mb-6">
        {#each data.activeIncidents as incident (incident.id)}
          <div class="rounded-lg border {incident.severity === 'critical' ? 'border-red-500/30 bg-red-500/5' : incident.severity === 'major' ? 'border-orange-500/30 bg-orange-500/5' : 'border-yellow-500/30 bg-yellow-500/5'} px-4 py-3">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded {incident.severity === 'critical' ? 'bg-red-500/15 text-red-700 dark:text-red-400' : incident.severity === 'major' ? 'bg-orange-500/15 text-orange-700 dark:text-orange-400' : 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400'}">{incident.severity}</span>
              <span class="text-xs text-muted-foreground capitalize">{incident.status}</span>
            </div>
            <p class="text-sm font-semibold">{incident.title}</p>
            {#if incident.updates.length > 0}
              <div class="mt-2 space-y-1.5 border-l-2 border-muted pl-3">
                {#each incident.updates as update (update.id)}
                  <div>
                    <div class="flex items-center gap-1.5">
                      <span class="text-[10px] font-medium uppercase text-muted-foreground">{update.status}</span>
                      <span class="text-[10px] text-muted-foreground">{new Date(update.createdAt).toLocaleString()}</span>
                    </div>
                    <p class="text-xs">{update.message}</p>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <div class="space-y-3">
      {#each data.monitors as monitor, i (monitor.name + '-' + i)}
        <div class="rounded-lg border bg-card p-4 transition-colors hover:bg-accent/30">
          <div class="flex items-center gap-3 mb-3">
            <span class="h-2.5 w-2.5 rounded-full {statusDot(monitor.status)} shadow-sm shrink-0"></span>
            <span class="font-medium text-sm flex-1 truncate">{monitor.name}</span>
            <span class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-1.5 py-0.5 rounded bg-muted">{getMonitorTypeLabel(monitor.type)}</span>
            {#if avgUptime(monitor.uptimeHistory) != null}
              <span class="text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full ring-1 ring-inset {badgeColor(avgUptime(monitor.uptimeHistory) ?? 0)}">
                {avgUptime(monitor.uptimeHistory)?.toFixed(1)}%
              </span>
            {/if}
          </div>

          <div class="flex items-center gap-[2px]">
            {#each Array(Math.max(0, 45 - monitor.uptimeHistory.length)) as _}
              <div class="bar-cell flex-1 min-w-[6px] h-[22px] rounded-sm bg-muted">
                <span class="bar-tooltip">No data</span>
              </div>
            {/each}
            {#each monitor.uptimeHistory.slice(-45) as bucket}
              <div class="bar-cell flex-1 min-w-[6px] h-[22px] rounded-sm {barColor(bucket.uptimePct)} transition-colors hover:brightness-110">
                <span class="bar-tooltip">{new Date(bucket.bucket).toLocaleDateString()}<br/>{pct(bucket.uptimePct).toFixed(1)}%</span>
              </div>
            {/each}
          </div>
          <div class="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
            <span>45d ago</span>
            <span>Now</span>
          </div>
        </div>
      {/each}
    </div>

    {#if data.monitors.length === 0}
      <div class="rounded-lg border border-dashed bg-card p-8 text-center">
        <p class="text-sm text-muted-foreground">No monitors configured for this project.</p>
      </div>
    {/if}

    {#if data.recentIncidents.length > 0}
      <div class="mt-6">
        <h2 class="text-sm font-semibold mb-3 text-muted-foreground">Past incidents (last 7 days)</h2>
        <div class="space-y-3">
          {#each data.recentIncidents as incident (incident.id)}
            <div class="rounded-lg border bg-card px-4 py-3">
              <div class="flex items-center justify-between mb-1">
                <p class="text-sm font-medium">{incident.title}</p>
                <span class="text-[10px] text-muted-foreground">{new Date(incident.resolvedAt ?? incident.createdAt).toLocaleDateString()}</span>
              </div>
              {#if incident.updates.length > 0}
                <div class="space-y-1 border-l-2 border-muted pl-3 mt-2">
                  {#each incident.updates as update (update.id)}
                    <div>
                      <div class="flex items-center gap-1.5">
                        <span class="text-[10px] font-medium uppercase text-muted-foreground">{update.status}</span>
                        <span class="text-[10px] text-muted-foreground">{new Date(update.createdAt).toLocaleString()}</span>
                      </div>
                      <p class="text-xs text-muted-foreground">{update.message}</p>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <div class="mt-6 text-center text-[10px] text-muted-foreground space-y-1">
      <p>Last updated {new Date(data.lastUpdated).toLocaleString()}</p>
      <p><a href="https://logtide.dev" class="hover:text-foreground transition-colors">Powered by LogTide</a></p>
    </div>
  {/if}
</div>

<style>
  .bar-cell {
    position: relative;
    cursor: default;
  }

  .bar-tooltip {
    display: none;
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 11px;
    line-height: 1.4;
    white-space: nowrap;
    text-align: center;
    pointer-events: none;
    z-index: 50;
    background: hsl(var(--popover));
    color: hsl(var(--popover-foreground));
    border: 1px solid hsl(var(--border));
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  }

  .bar-tooltip::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 4px solid transparent;
    border-top-color: hsl(var(--border));
  }

  .bar-cell:hover .bar-tooltip {
    display: block;
  }
</style>
