<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { UserBasic } from '$lib/api/admin';
  import DataTable from '$lib/components/app/DataTable.svelte';
  import type { DataTableColumn, DataTableSort } from '$lib/components/app/data-table';
  import Avatar from '$lib/components/app/Avatar.svelte';
  import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { formatCount } from '$lib/utils/format-number';

  interface Props {
    users: UserBasic[];
    sort?: DataTableSort;
    loading?: boolean;
    empty?: Snippet;
  }

  let { users, sort = $bindable(undefined), loading = false, empty }: Props = $props();

  // Snippets declared in the template are typed loosely by svelte-check.
  const asCell = (s: unknown) => s as Snippet<[UserBasic]>;

  const columns: DataTableColumn<UserBasic>[] = [
    { key: 'email', header: 'User', sortable: true, class: 'min-w-[14rem] max-w-[24rem]', cell: asCell(userCell) },
    { key: 'role', header: 'Role', cell: asCell(roleCell) },
    { key: 'status', header: 'Status', cell: asCell(statusCell) },
    { key: 'orgs', header: 'Organizations', class: 'text-right tabular-nums', cell: asCell(orgsCell) },
    { key: 'last_login', header: 'Last login', sortable: true, class: 'whitespace-nowrap', cell: asCell(lastLoginCell) },
    { key: 'created_at', header: 'Created', sortable: true, class: 'whitespace-nowrap', cell: asCell(createdCell) },
  ];
</script>

{#snippet userCell(u: UserBasic)}
  <div class="flex min-w-0 items-center gap-3">
    <Avatar name={u.name || u.email} email={u.email} size="sm" />
    <div class="min-w-0">
      <a
        href="/dashboard/admin/users/{u.id}"
        class="block truncate font-medium underline-offset-4 hover:text-primary hover:underline"
      >
        {u.email}
      </a>
      {#if u.name}
        <p class="truncate text-xs text-muted-foreground">{u.name}</p>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet roleCell(u: UserBasic)}
  {#if u.is_admin}
    <Badge variant="secondary">Admin</Badge>
  {:else}
    <Badge variant="outline">User</Badge>
  {/if}
{/snippet}

{#snippet statusCell(u: UserBasic)}
  <SeverityBadge kind="state" value={u.disabled ? 'disabled' : 'active'} />
{/snippet}

{#snippet orgsCell(u: UserBasic)}
  {formatCount(u.orgCount)}
{/snippet}

{#snippet lastLoginCell(u: UserBasic)}
  {#if u.last_login}
    <Timestamp value={u.last_login} relative />
  {:else}
    <span class="text-muted-foreground">Never</span>
  {/if}
{/snippet}

{#snippet createdCell(u: UserBasic)}
  <span class="text-muted-foreground"><Timestamp value={u.created_at} precision="minute" /></span>
{/snippet}

{#snippet mobileRow(u: UserBasic)}
  <div class="space-y-1.5">
    <div class="flex items-start justify-between gap-2">
      <a href="/dashboard/admin/users/{u.id}" class="min-w-0 truncate font-medium hover:text-primary">{u.email}</a>
      <SeverityBadge kind="state" value={u.disabled ? 'disabled' : 'active'} />
    </div>
    <p class="text-xs text-muted-foreground">
      {u.name ? `${u.name} - ` : ''}{u.is_admin ? 'Admin' : 'User'} - {formatCount(u.orgCount)} organizations
    </p>
    <p class="text-xs text-muted-foreground">
      Last login: {#if u.last_login}<Timestamp value={u.last_login} relative />{:else}Never{/if}
    </p>
  </div>
{/snippet}

<DataTable
  {columns}
  rows={users}
  {loading}
  rowKey={(u) => u.id}
  bind:sort
  mobileRow={asCell(mobileRow)}
  {empty}
/>
