<script lang="ts">
  import { onMount } from 'svelte';
  import { getApiUrl } from '$lib/config';
  import { page } from '$app/stores';
  import { themeStore } from '$lib/stores/theme';
  import { getAuthToken } from '$lib/utils/auth';
  import { displayPreferences } from '$lib/stores/display-preferences';
  import { formatDateShort, getDisplayZoneLabel } from '$lib/utils/datetime';
  import { levelTone, severityTone, stateTone } from '$lib/utils/severity';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import type {
    PublicMaintenance,
    PublicStatusIncident,
    PublicStatusPage,
  } from '$lib/api/status-page';
  import PublicStatusHeader from '$lib/components/monitoring/public/PublicStatusHeader.svelte';
  import PublicMonitorGroup from '$lib/components/monitoring/public/PublicMonitorGroup.svelte';
  import PublicSubscribeForm from '$lib/components/monitoring/public/PublicSubscribeForm.svelte';
  import { groupMonitors } from '$lib/components/monitoring/public/group-monitors';
  import {
    statusUpdateSeverityLabel,
    statusUpdateSeverityTone,
    statusUpdateStatusLabel,
  } from '$lib/components/monitoring/monitor-meta';

  const theme = $derived($themeStore);

  let data = $state<PublicStatusPage | null>(null);
  let loading = $state(true);
  let notFound = $state(false);
  let fetchError = $state<string | null>(null);

  let requiresPassword = $state(false);
  let requiresAuth = $state(false);
  let passwordInput = $state('');
  let passwordError = $state<string | null>(null);
  let pendingPassword = $state<string | null>(null);

  const orgSlug = $derived($page.params.orgSlug ?? '');
  const projectSlug = $derived($page.params.projectSlug ?? '');
  const pageTitle = $derived(data?.title?.trim() || data?.projectName || projectSlug);

  function getStoredPassword(): string | null {
    try {
      return sessionStorage.getItem(`status-pw-${orgSlug}-${projectSlug}`);
    } catch {
      return null;
    }
  }

  function storePassword(pw: string) {
    try {
      sessionStorage.setItem(`status-pw-${orgSlug}-${projectSlug}`, pw);
    } catch {
      // storage can be blocked; the password is then asked again on reload
    }
  }

  // A background refresh keeps the current page on screen: no spinner and no
  // error banner replacing good data when one poll fails.
  async function load(background = false) {
    if (!orgSlug || !projectSlug) return;
    if (!background) {
      loading = true;
      fetchError = null;
      notFound = false;
    }

    const headers: Record<string, string> = {};
    const pw = pendingPassword ?? getStoredPassword();
    if (pw) headers['X-Status-Password'] = pw;
    const token = getAuthToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(`${getApiUrl()}/api/v1/status/${orgSlug}/${projectSlug}`, { headers });
      if (res.status === 404) {
        notFound = true;
        data = null;
        return;
      }
      if (res.status === 401) {
        const body = await res.json();
        if (body.requiresPassword) {
          requiresPassword = true;
          requiresAuth = false;
          data = null;
          if (pw) {
            passwordError = 'Invalid password';
            pendingPassword = null;
            try {
              sessionStorage.removeItem(`status-pw-${orgSlug}-${projectSlug}`);
            } catch {
              // nothing stored to clear
            }
          }
          return;
        }
        if (body.requiresAuth) {
          requiresAuth = true;
          requiresPassword = false;
          data = null;
          return;
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      requiresPassword = false;
      requiresAuth = false;
      notFound = false;
      fetchError = null;
      if (pw) storePassword(pw);
      pendingPassword = null;
      data = await res.json();
    } catch (err) {
      if (!background || !data) {
        fetchError = err instanceof Error ? err.message : 'Could not load the status page';
      }
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
    const interval = setInterval(() => load(true), 60000);
    return () => clearInterval(interval);
  });

  const OVERALL = {
    operational: { label: 'All systems operational', tone: () => stateTone('up') },
    degraded: { label: 'Partial system outage', tone: () => severityTone('medium') },
    outage: { label: 'Major system outage', tone: () => stateTone('down') },
  } as const;

  const overall = $derived(data ? OVERALL[data.overallStatus] ?? OVERALL.operational : null);
  const groups = $derived(data ? groupMonitors(data.monitors) : []);

  // Past updates grouped by calendar day in the viewer's display zone.
  interface DayGroup {
    day: string;
    incidents: PublicStatusIncident[];
  }
  const pastByDay = $derived.by<DayGroup[]>(() => {
    $displayPreferences;
    if (!data) return [];
    const out: DayGroup[] = [];
    for (const incident of data.recentIncidents) {
      const day = formatDateShort(incident.resolvedAt ?? incident.createdAt);
      const last = out[out.length - 1];
      if (last && last.day === day) last.incidents.push(incident);
      else out.push({ day, incidents: [incident] });
    }
    return out;
  });

  const zoneLabel = $derived.by(() => {
    $displayPreferences;
    return getDisplayZoneLabel();
  });
</script>

<svelte:head>
  <title>{pageTitle} - Status</title>
</svelte:head>

{#snippet components(names: string[])}
  {#if names.length > 0}
    <div class="mt-2 flex flex-wrap gap-1.5">
      {#each names as name (name)}
        <span class="inline-flex items-center rounded-md border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {name}
        </span>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet themeToggle()}
  <button
    type="button"
    onclick={() => themeStore.toggle()}
    class="flex h-8 w-8 items-center justify-center rounded-md border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
  >
    {#if theme === 'dark'}
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
    {:else}
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    {/if}
  </button>
{/snippet}

{#snippet maintenanceCard(m: PublicMaintenance, active: boolean)}
  {@const tone = levelTone('info')}
  <div class="rounded-lg border px-4 py-3 {tone.badge}">
    <div class="mb-1 flex items-center gap-2">
      <span class="h-2 w-2 rounded-full {tone.dot} {active ? 'animate-pulse' : ''}"></span>
      <span class="text-sm font-semibold">{active ? 'Maintenance in progress' : 'Scheduled maintenance'}</span>
    </div>
    <p class="text-sm font-medium text-foreground">{m.title}</p>
    {#if m.description}
      <p class="mt-0.5 text-xs text-muted-foreground">{m.description}</p>
    {/if}
    <p class="mt-1 text-xs text-muted-foreground">
      <Timestamp value={m.scheduledStart} precision="minute" />
      <span> to </span>
      <Timestamp value={m.scheduledEnd} precision="minute" />
    </p>
    {@render components(m.affectedComponents ?? [])}
  </div>
{/snippet}

{#snippet updateList(incident: PublicStatusIncident)}
  {#if incident.updates.length > 0}
    <div class="mt-2 space-y-1.5 border-l-2 border-muted pl-3">
      {#each incident.updates as update (update.id)}
        <div>
          <div class="flex items-center gap-1.5">
            <span class="text-xs font-medium text-muted-foreground">{statusUpdateStatusLabel(update.status)}</span>
            <span class="text-xs text-muted-foreground">
              <Timestamp value={update.createdAt} precision="minute" />
            </span>
          </div>
          <p class="text-xs">{update.message}</p>
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

<div class="mx-auto max-w-3xl px-3 py-6 sm:px-6 sm:py-10">
  {#if loading && !data}
    <div class="flex items-center justify-center py-32" role="status" aria-label="Loading">
      <div class="h-8 w-8 animate-spin rounded-full border-[3px] border-muted border-t-primary"></div>
    </div>
  {:else if requiresPassword}
    <div class="py-32 text-center">
      <div class="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </div>
      <h1 class="mb-2 text-xl font-semibold">Password required</h1>
      <p class="mb-4 text-sm text-muted-foreground">This status page is password protected.</p>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          submitPassword();
        }}
        class="inline-flex flex-col items-center gap-3"
      >
        <label for="status-password" class="sr-only">Password</label>
        <input
          id="status-password"
          type="password"
          bind:value={passwordInput}
          placeholder="Enter password"
          class="h-10 w-full max-w-xs rounded-md border bg-background px-3 text-center text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {#if passwordError}
          <p class="text-xs text-destructive-text" role="alert">{passwordError}</p>
        {/if}
        <button
          type="submit"
          class="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          View status
        </button>
      </form>
    </div>
  {:else if requiresAuth}
    <div class="py-32 text-center">
      <div class="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      </div>
      <h1 class="mb-2 text-xl font-semibold">Login required</h1>
      <p class="mb-4 text-sm text-muted-foreground">This status page is only available to organization members.</p>
      <a
        href="/login"
        class="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Log in
      </a>
    </div>
  {:else if notFound}
    <div class="py-32 text-center">
      <div class="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <span class="text-2xl" aria-hidden="true">?</span>
      </div>
      <h1 class="mb-2 text-xl font-semibold">Status page not found</h1>
      <p class="text-sm text-muted-foreground">
        The project <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{projectSlug}</code> does not have a public status page.
      </p>
    </div>
  {:else if fetchError && !data}
    <div class="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-center text-sm text-destructive-text" role="alert">
      {fetchError}
    </div>
  {:else if data && overall}
    {@const bannerTone = overall.tone()}
    <PublicStatusHeader
      title={pageTitle}
      description={data.description}
      logoUrl={data.logoUrl}
      accentColor={data.accentColor}
      subscribeHref={data.subscriptionsEnabled ? '#subscribe' : undefined}
    >
      {#snippet actions()}
        {@render themeToggle()}
      {/snippet}
    </PublicStatusHeader>

    <div class="mb-6 flex items-center gap-3 rounded-lg border px-4 py-3 {bannerTone.badge}" role="status">
      <span class="h-3 w-3 rounded-full {bannerTone.dot}"></span>
      <span class="text-sm font-semibold">{overall.label}</span>
    </div>

    {#if data.activeMaintenances.length > 0 || data.upcomingMaintenances.length > 0}
      <div class="mb-6 space-y-2">
        {#each data.activeMaintenances as m (m.id)}
          {@render maintenanceCard(m, true)}
        {/each}
        {#each data.upcomingMaintenances as m (m.id)}
          {@render maintenanceCard(m, false)}
        {/each}
      </div>
    {/if}

    {#if data.activeIncidents.length > 0}
      <div class="mb-6 space-y-3">
        {#each data.activeIncidents as incident (incident.id)}
          {@const tone = severityTone(statusUpdateSeverityTone(incident.severity))}
          <div class="rounded-lg border bg-card px-4 py-3">
            <div class="mb-1 flex items-center gap-2">
              <span class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium {tone.badge}">
                {statusUpdateSeverityLabel(incident.severity)}
              </span>
              <span class="text-xs text-muted-foreground">{statusUpdateStatusLabel(incident.status)}</span>
            </div>
            <p class="text-sm font-semibold">{incident.title}</p>
            {@render components(incident.affectedComponents ?? [])}
            {@render updateList(incident)}
          </div>
        {/each}
      </div>
    {/if}

    {#if data.monitors.length === 0}
      <div class="rounded-lg border border-dashed bg-card p-8 text-center">
        <p class="text-sm text-muted-foreground">No components are listed on this status page yet.</p>
      </div>
    {:else}
      <PublicMonitorGroup {groups} days={data.historyDays || 90} />
    {/if}

    {#if data.subscriptionsEnabled}
      <div class="mt-8">
        <PublicSubscribeForm {orgSlug} {projectSlug} accentColor={data.accentColor} />
      </div>
    {/if}

    {#if pastByDay.length > 0}
      <div class="mt-8">
        <h2 class="mb-3 text-sm font-semibold text-muted-foreground">Past status updates</h2>
        <div class="space-y-5">
          {#each pastByDay as group (group.day)}
            <section>
              <h3 class="mb-2 text-xs font-medium text-muted-foreground">{group.day}</h3>
              <div class="space-y-3">
                {#each group.incidents as incident (incident.id)}
                  <div class="rounded-lg border bg-card px-4 py-3">
                    <p class="text-sm font-medium">{incident.title}</p>
                    {@render components(incident.affectedComponents ?? [])}
                    {@render updateList(incident)}
                  </div>
                {/each}
              </div>
            </section>
          {/each}
        </div>
      </div>
    {/if}

    <div class="mt-8 space-y-1.5 text-center text-xs text-muted-foreground">
      <p>
        Last updated <Timestamp value={data.lastUpdated} precision="minute" />. Times are shown in {zoneLabel}; uptime days are UTC days.
      </p>
      <p>
        Powered by
        <a href="https://logtide.dev" class="font-medium text-primary underline-offset-2 hover:underline">LogTide</a>
      </p>
    </div>
  {/if}
</div>
