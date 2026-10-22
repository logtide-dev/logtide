<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { organizationStore } from "$lib/stores/organization";
  import { toastStore } from "$lib/stores/toast";
  import { OrganizationsAPI } from "$lib/api/organizations";
  import { authStore } from "$lib/stores/auth";
  import type { OrganizationWithRole } from "@logtide/shared";
  import {
    Popover,
    PopoverContent,
    PopoverTrigger,
  } from "$lib/components/ui/popover";
  import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
  } from "$lib/components/ui/command";
  import CreateOrganizationDialog from "./CreateOrganizationDialog.svelte";
  import { switchOrganization, resetOrgScopedState } from "$lib/components/shell/org-switch";
  import { OPEN_ORG_SWITCHER_EVENT } from "$lib/components/shell/events";
  import Building2 from "@lucide/svelte/icons/building-2";
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Plus from "@lucide/svelte/icons/plus";

  interface Props {
    /** 'breadcrumb' renders a compact text trigger for the header. */
    variant?: "breadcrumb" | "block";
  }

  let { variant = "block" }: Props = $props();

  let open = $state(false);
  let showCreateDialog = $state(false);

  let authState = $state({ user: null, token: null, loading: false });
  let orgState = $state({ organizations: [], currentOrganization: null });

  const unsubAuthStore = authStore.subscribe((state) => {
    authState = state;
  });

  const unsubOrgStore = organizationStore.subscribe((state) => {
    orgState = state;
  });

  onDestroy(() => {
    unsubAuthStore();
    unsubOrgStore();
  });

  // The command palette action "Switch organization" opens this popover.
  onMount(() => {
    const openSwitcher = () => (open = true);
    window.addEventListener(OPEN_ORG_SWITCHER_EVENT, openSwitcher);
    return () => window.removeEventListener(OPEN_ORG_SWITCHER_EVENT, openSwitcher);
  });

  let organizations = $derived(orgState.organizations);
  let currentOrg = $derived(orgState.currentOrganization);
  let token = $derived(authState.token);

  function selectOrganization(org: OrganizationWithRole) {
    const alreadyActive = currentOrg?.id === org.id;
    switchOrganization(org);
    open = false;
    if (!alreadyActive) toastStore.success(`Switched to ${org.name}`);
  }

  async function handleCreateOrganization(data: {
    name: string;
    description?: string;
  }) {
    if (!token) return;

    try {
      const organizationsAPI = new OrganizationsAPI(() => token);
      const response = await organizationsAPI.createOrganization({
        name: data.name,
        description: data.description,
      });

      const newOrg: OrganizationWithRole = {
        ...response.organization,
        role: "owner",
      };

      organizationStore.addOrganization(newOrg);
      resetOrgScopedState();
      toastStore.success(`Organization "${data.name}" created`);
      goto("/dashboard/projects?create=1");
    } catch (e) {
      const errorMsg =
        e instanceof Error ? e.message : "Failed to create organization";
      throw new Error(errorMsg);
    }
  }
</script>

<Popover bind:open>
  {#if variant === "breadcrumb"}
    <PopoverTrigger
      class="inline-flex items-center gap-1.5 min-w-0 max-w-[10rem] rounded-md px-2 py-1 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      role="combobox"
      aria-expanded={open}
      aria-label="Switch organization"
      title={currentOrg?.name}
      data-org-switcher
    >
      <Building2 class="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <span class="truncate">{currentOrg?.name || "Select organization"}</span>
      <ChevronDown class="w-3.5 h-3.5 opacity-50 flex-shrink-0" />
    </PopoverTrigger>
  {:else}
    <PopoverTrigger
      class="inline-flex items-center justify-between w-full h-10 px-4 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 rounded-md border border-input bg-background"
      role="combobox"
      aria-expanded={open}
      aria-label="Switch organization"
      data-org-switcher
    >
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <div
          class="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-primary flex-shrink-0"
        >
          {#if currentOrg}
            <span class="text-xs font-semibold"
              >{currentOrg.name.charAt(0).toUpperCase()}</span
            >
          {:else}
            <Building2 class="w-4 h-4" />
          {/if}
        </div>
        <span class="truncate text-sm flex-1 text-left">
          {currentOrg?.name || "Select organization"}
        </span>
      </div>
      <ChevronDown class="ml-2 w-4 h-4 opacity-50 flex-shrink-0" />
    </PopoverTrigger>
  {/if}

  <PopoverContent class="w-56 p-0" align="start">
    <Command>
      <CommandInput placeholder="Search organizations" />
      <CommandList>
        <CommandEmpty>No organization found.</CommandEmpty>

        <CommandGroup heading="Your organizations">
          {#each organizations as org}
            <CommandItem
              value={org.name}
              onSelect={() => selectOrganization(org)}
              class="cursor-pointer"
            >
              <div class="flex items-center gap-2 w-full">
                <div
                  class="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold flex-shrink-0"
                >
                  {org.name.charAt(0).toUpperCase()}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="font-medium truncate text-sm">{org.name}</div>
                  <div class="text-xs text-muted-foreground truncate">
                    {org.role}
                  </div>
                </div>
                {#if currentOrg?.id === org.id}
                  <Check class="w-4 h-4 text-primary flex-shrink-0" />
                {/if}
              </div>
            </CommandItem>
          {/each}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup>
          <CommandItem
            onSelect={() => {
              open = false;
              showCreateDialog = true;
            }}
            class="cursor-pointer"
          >
            <div class="flex items-center gap-2 w-full">
              <div
                class="w-6 h-6 rounded border-2 border-dashed border-muted-foreground/30 flex items-center justify-center flex-shrink-0"
              >
                <Plus class="w-3 h-3" />
              </div>
              <span class="text-sm">Create organization</span>
            </div>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  </PopoverContent>
</Popover>

<CreateOrganizationDialog
  bind:open={showCreateDialog}
  onSubmit={handleCreateOrganization}
/>
