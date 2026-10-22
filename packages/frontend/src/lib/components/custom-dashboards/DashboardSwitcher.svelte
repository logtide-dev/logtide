<script lang="ts">
  // Dropdown that lets the user switch between dashboards, create new ones,
  // import/export YAML, and delete the active dashboard.
  //
  // Lives in the page header of /dashboard/+page.svelte. There is no list
  // page - this is the only entry point to the dashboard catalog.

  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { Button } from '$lib/components/ui/button';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Plus from '@lucide/svelte/icons/plus';
  import Download from '@lucide/svelte/icons/download';
  import Upload from '@lucide/svelte/icons/upload';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Copy from '@lucide/svelte/icons/copy';
  import LayoutTemplate from '@lucide/svelte/icons/layout-template';
  import Star from '@lucide/svelte/icons/star';
  import User from '@lucide/svelte/icons/user';
  import type { CustomDashboard } from '@logtide/shared';

  interface Props {
    dashboards: CustomDashboard[];
    active: CustomDashboard | null;
    disabled?: boolean;
    onSelect: (dashboard: CustomDashboard) => void;
    onCreate: () => void;
    onCreateFromTemplate: () => void;
    onRename: () => void;
    onDuplicate: () => void;
    onImport: () => void;
    onExport: () => void;
    onDelete: () => void;
    onSetDefault: (dashboard: CustomDashboard) => void;
  }

  let {
    dashboards,
    active,
    disabled = false,
    onSelect,
    onCreate,
    onCreateFromTemplate,
    onRename,
    onDuplicate,
    onImport,
    onExport,
    onDelete,
    onSetDefault,
  }: Props = $props();

  function canBeDefault(d: CustomDashboard): boolean {
    return !d.isDefault && !d.isPersonal && d.projectId === null;
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger {disabled}>
    {#snippet child({ props })}
      <Button {...props} variant="outline" class="gap-2 max-w-[300px]">
        {#if active?.isDefault}
          <Star class="w-4 h-4 text-amber-500" />
        {:else if active?.isPersonal}
          <User class="w-4 h-4 text-muted-foreground" />
        {/if}
        <span class="truncate">{active?.name ?? 'Select dashboard…'}</span>
        <ChevronDown class="w-4 h-4 opacity-60" />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="start" class="w-72">
    {#if dashboards.length === 0}
      <DropdownMenu.Label>No dashboards yet</DropdownMenu.Label>
    {:else}
      <DropdownMenu.Label>Switch dashboard</DropdownMenu.Label>
      {#each dashboards as dashboard (dashboard.id)}
        <DropdownMenu.Item onSelect={() => onSelect(dashboard)} class="gap-2">
          {#if dashboard.isDefault}
            <Star class="w-4 h-4 text-amber-500 fill-amber-500 flex-shrink-0" />
          {:else if dashboard.isPersonal}
            <User class="w-4 h-4 text-muted-foreground flex-shrink-0" />
          {:else}
            <span class="w-4 h-4 flex-shrink-0"></span>
          {/if}
          <span class="truncate flex-1">{dashboard.name}</span>
          {#if active?.id === dashboard.id}
            <span class="text-xs text-primary">Active</span>
          {/if}
          {#if canBeDefault(dashboard)}
            <button
              type="button"
              class="p-0.5 -m-0.5 rounded text-muted-foreground hover:text-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Set as default"
              aria-label="Set as default dashboard"
              onpointerdown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onSetDefault(dashboard);
              }}
              onpointerup={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              onclick={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              <Star class="w-4 h-4" />
            </button>
          {/if}
        </DropdownMenu.Item>
      {/each}
    {/if}
    <DropdownMenu.Separator />
    <DropdownMenu.Item onSelect={onCreate} class="gap-2">
      <Plus class="w-4 h-4" />
      New dashboard
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={onCreateFromTemplate} class="gap-2">
      <LayoutTemplate class="w-4 h-4" />
      New from template…
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={onImport} class="gap-2">
      <Upload class="w-4 h-4" />
      Import YAML…
    </DropdownMenu.Item>
    {#if active}
      <DropdownMenu.Item onSelect={onRename} class="gap-2">
        <Pencil class="w-4 h-4" />
        Rename
      </DropdownMenu.Item>
      <DropdownMenu.Item onSelect={onDuplicate} class="gap-2">
        <Copy class="w-4 h-4" />
        Duplicate
      </DropdownMenu.Item>
      <DropdownMenu.Item onSelect={onExport} class="gap-2">
        <Download class="w-4 h-4" />
        Export as YAML
      </DropdownMenu.Item>
      {#if !active.isDefault}
        <DropdownMenu.Separator />
        <DropdownMenu.Item onSelect={onDelete} class="gap-2 text-destructive focus:text-destructive">
          <Trash2 class="w-4 h-4" />
          Delete dashboard
        </DropdownMenu.Item>
      {/if}
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
