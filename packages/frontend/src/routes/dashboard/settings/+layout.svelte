<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { authAPI, type AuthConfig } from '$lib/api/auth';
  import { organizationStore } from '$lib/stores/organization';
  import { layoutStore } from '$lib/stores/layout';
  import type { OrganizationWithRole } from '@logtide/shared';
  import SectionNav from '$lib/components/settings/SectionNav.svelte';
  import { visibleSettingsGroups } from '$lib/components/settings/settings-nav';

  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  let currentOrg = $state<OrganizationWithRole | null>(null);
  let maxWidthClass = $state('max-w-7xl');
  let containerPadding = $state('px-6 py-8');

  $effect(() => {
    const unsubscribe = layoutStore.maxWidthClass.subscribe((value) => {
      maxWidthClass = value;
    });
    return unsubscribe;
  });

  $effect(() => {
    const unsubscribe = layoutStore.containerPadding.subscribe((value) => {
      containerPadding = value;
    });
    return unsubscribe;
  });

  $effect(() => {
    const unsubscribe = organizationStore.subscribe((state) => {
      currentOrg = state.currentOrganization;
    });
    return unsubscribe;
  });

  // Auth config gates settings entries that depend on the instance setup
  // (extensions); a failed config call leaves them hidden.
  let authConfig = $state<AuthConfig | null>(null);

  onMount(async () => {
    try {
      authConfig = await authAPI.getAuthConfig();
    } catch {
      authConfig = null;
    }
  });

  let groups = $derived(visibleSettingsGroups({ role: currentOrg?.role ?? null, authConfig }));

  function isActive(href: string): boolean {
    return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
  }
</script>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
  <div class="flex flex-col lg:flex-row gap-8">
    <SectionNav {groups} {isActive} ariaLabel="Settings navigation" />

    <div class="flex-1 min-w-0">
      {@render children?.()}
    </div>
  </div>
</div>
