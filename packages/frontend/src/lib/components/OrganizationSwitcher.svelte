<script lang="ts">
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
  import Button from "$lib/components/ui/button/button.svelte";
  import { Separator } from "$lib/components/ui/separator";
  import CreateOrganizationDialog from "./CreateOrganizationDialog.svelte";
  import Building2 from "@lucide/svelte/icons/building-2";
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Plus from "@lucide/svelte/icons/plus";

  let open = $state(false);
  let showCreateDialog = $state(false);

  let authState = $state({ user: null, token: null, loading: false });
  let orgState = $state({ organizations: [], currentOrganization: null });

  authStore.subscribe((state) => {
    authState = state;
  });

  organizationStore.subscribe((state) => {
    orgState = state;
  });

  let organizations = $derived(orgState.organizations);
  let currentOrg = $derived(orgState.currentOrganization);
  let token = $derived(authState.token);

  function selectOrganization(org: OrganizationWithRole) {
    organizationStore.setCurrentOrganization(org);
    open = false;
    toastStore.success(`Switched to ${org.name}`);
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
      toastStore.success(`Organization "${data.name}" created successfully!`);
    } catch (e) {
      const errorMsg =
        e instanceof Error ? e.message : "Failed to create organization";
      throw new Error(errorMsg);
    }
  }
</script>

<Popover bind:open>
  <PopoverTrigger
    class="inline-flex items-center justify-between w-full h-10 px-4 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 rounded-md border border-input bg-background"
    role="combobox"
    aria-expanded={open}
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

  <PopoverContent class="w-56 p-0" align="start">
    <Command>
      <CommandInput placeholder="Search organizations..." />
      <CommandList>
        <CommandEmpty>No organization found.</CommandEmpty>

        <CommandGroup heading="Your Organizations">
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
              <span class="text-sm">Create Organization</span>
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
