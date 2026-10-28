<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { PROJECT_HEALTH_CHECKS, type ProjectHealthCheckKey } from '@logtide/shared';
  import { projectHealthStore } from '$lib/stores/project-health';
  import { orgProjectsStore } from '$lib/stores/org-projects';
  import { readScopeFromUrl } from '$lib/stores/scope-url';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import X from '@lucide/svelte/icons/x';

  interface Props {
    organizationId: string;
  }

  let { organizationId }: Props = $props();

  const DATA_PREFIXES = [
    '/dashboard/logs',
    '/dashboard/metrics',
    '/dashboard/traces',
    '/dashboard/errors',
  ];

  const onDataPage = $derived(
    DATA_PREFIXES.some((p) => page.url.pathname === p || page.url.pathname.startsWith(`${p}/`)),
  );

  // Bumped on dismiss so the derived below re-reads the stored signature.
  let dismissVersion = $state(0);
  let dismissedInMemory: string | null = null;

  $effect(() => {
    const orgId = organizationId;
    if (!onDataPage || !orgId) return;
    untrack(() => {
      void projectHealthStore.load(orgId);
      if ($orgProjectsStore.orgId !== orgId && !$orgProjectsStore.loading) {
        void orgProjectsStore.load(orgId);
      }
    });
    // Subscribing keeps the store polling while a data page is open.
    return projectHealthStore.subscribe(() => {});
  });

  const scoped = $derived.by(() => {
    if (!onDataPage) return [];
    if ($projectHealthStore.orgId !== organizationId) return [];
    const ids = readScopeFromUrl(page.url).projectIds ?? [];
    const out: { id: string; name: string; checks: ProjectHealthCheckKey[] }[] = [];
    for (const p of $orgProjectsStore.projects) {
      if (p.deletedAt) continue;
      if (ids.length > 0 && !ids.includes(p.id)) continue;
      const entry = $projectHealthStore.byProject[p.id];
      const checks = (entry?.openIssues ?? []).filter((i) => !i.muted).map((i) => i.checkKey);
      if (checks.length > 0) out.push({ id: p.id, name: p.name, checks });
    }
    return out;
  });

  const signature = $derived(
    scoped
      .flatMap((p) => p.checks.map((c) => `${p.id}:${c}`))
      .sort()
      .join(','),
  );

  const storageKey = $derived(`project-health-banner:${organizationId}`);

  function dismissedSignature(): string | null {
    try {
      return sessionStorage.getItem(storageKey) ?? dismissedInMemory;
    } catch {
      return dismissedInMemory;
    }
  }

  const visible = $derived.by(() => {
    dismissVersion;
    if (scoped.length === 0) return false;
    return dismissedSignature() !== signature;
  });

  function dismiss() {
    dismissedInMemory = signature;
    try {
      sessionStorage.setItem(storageKey, signature);
    } catch {
      // storage unavailable: the in-memory value still hides it for this view
    }
    dismissVersion += 1;
  }

  const message = $derived.by(() => {
    if (scoped.length === 1) {
      const p = scoped[0];
      const n = p.checks.length;
      const titles = p.checks.map((c) => PROJECT_HEALTH_CHECKS[c]?.title ?? c).join(', ');
      return `${p.name} has ${n} health ${n === 1 ? 'issue' : 'issues'}: ${titles}`;
    }
    return `${scoped.length} projects have health issues: ${scoped.map((p) => p.name).join(', ')}`;
  });

  const href = $derived(
    scoped.length === 1 ? `/dashboard/projects/${scoped[0].id}` : '/dashboard/projects',
  );
</script>

{#if visible}
  <div
    role="status"
    data-testid="project-health-banner"
    class="flex items-start gap-3 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning-text"
  >
    <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
    <p class="flex-1">
      {message}
      <a {href} class="ml-1 font-medium underline underline-offset-2">Details</a>
    </p>
    <button
      type="button"
      class="rounded p-1 hover:bg-foreground/10"
      aria-label="Dismiss health banner"
      onclick={dismiss}
    >
      <X class="h-4 w-4" aria-hidden="true" />
    </button>
  </div>
{/if}
