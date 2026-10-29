<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { organizationStore } from '$lib/stores/organization';
  import { toastStore } from '$lib/stores/toast';
  import { OrganizationsAPI } from '$lib/api/organizations';
  import { InvitationsAPI } from '$lib/api/invitations';
  import Button from '$lib/components/ui/button/button.svelte';
  import { buttonVariants } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import type { OrganizationWithRole, OrganizationMemberWithUser, PendingInvitation, OrgRole } from '@logtide/shared';
  import { canManageMembers } from '@logtide/shared';
  import { cn } from '$lib/utils.js';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
  import Avatar from '$lib/components/app/Avatar.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import RoleCapabilitiesTable from '$lib/components/settings/RoleCapabilitiesTable.svelte';
  import { roleLabel } from '$lib/components/settings/roles';
  import Users from '@lucide/svelte/icons/users';
  import Crown from '@lucide/svelte/icons/crown';
  import Shield from '@lucide/svelte/icons/shield';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import UserPlus from '@lucide/svelte/icons/user-plus';
  import MoreHorizontal from '@lucide/svelte/icons/more-horizontal';
  import Mail from '@lucide/svelte/icons/mail';
  import Clock from '@lucide/svelte/icons/clock';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import X from '@lucide/svelte/icons/x';
  import LogOut from '@lucide/svelte/icons/log-out';
  import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from '$lib/components/ui/table';
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
  } from '$lib/components/ui/dropdown-menu';
  import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
  import InviteMemberDialog from '$lib/components/InviteMemberDialog.svelte';
  import { SkeletonTable } from '$lib/components/ui/skeleton';

  let user: any = null;
  let token: string | null = null;
  let currentOrg = $state<OrganizationWithRole | null>(null);

  let members = $state<OrganizationMemberWithUser[]>([]);
  let pendingInvitations = $state<PendingInvitation[]>([]);
  let loadingMembers = $state(false);
  let loadingInvitations = $state(false);
  let inviteDialogOpen = $state(false);

  let removeOpen = $state(false);
  let memberToRemove = $state<OrganizationMemberWithUser | null>(null);

  let transferOpen = $state(false);
  let memberToTransfer = $state<OrganizationMemberWithUser | null>(null);

  let confirmLeaveOpen = $state(false);
  let lastLoadedOrgId = $state<string | null>(null);

  const unsubAuthStore = authStore.subscribe((state) => {
    user = state.user;
    token = state.token;
  });

  const unsubOrgStore = organizationStore.subscribe((state) => {
    currentOrg = state.currentOrganization;
    if (currentOrg && currentOrg.id !== lastLoadedOrgId) {
      lastLoadedOrgId = currentOrg.id;
      loadMembers();
      loadInvitations();
    }
  });

  onDestroy(() => {
    unsubAuthStore();
    unsubOrgStore();
  });

  onMount(() => {
    if (!token) {
      goto('/login');
      return;
    }
  });

  async function loadMembers() {
    if (!currentOrg || !token) return;

    loadingMembers = true;
    try {
      const api = new OrganizationsAPI(() => token);
      const response = await api.getOrganizationMembers(currentOrg.id);
      members = response.members;
    } catch (e) {
      console.error('Failed to load members:', e);
      toastStore.error('Failed to load organization members');
    } finally {
      loadingMembers = false;
    }
  }

  async function loadInvitations() {
    if (!currentOrg || !token) return;
    if (!canManageMembers(currentOrg.role)) return;

    loadingInvitations = true;
    try {
      const api = new InvitationsAPI(() => token);
      const response = await api.getPendingInvitations(currentOrg.id);
      pendingInvitations = response.invitations;
    } catch (e) {
      console.error('Failed to load invitations:', e);
    } finally {
      loadingInvitations = false;
    }
  }

  async function handleInvite(data: { email: string; role: OrgRole }) {
    if (!currentOrg || !token) throw new Error('No organization selected');

    const api = new InvitationsAPI(() => token);
    const result = await api.inviteUser(currentOrg.id, data);

    await Promise.all([loadMembers(), loadInvitations()]);

    return result;
  }

  async function handleRevokeInvitation(invitationId: string) {
    if (!currentOrg || !token) return;

    try {
      const api = new InvitationsAPI(() => token);
      await api.revokeInvitation(currentOrg.id, invitationId);
      toastStore.success('Invitation revoked');
      await loadInvitations();
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to revoke invitation';
      toastStore.error(errorMsg);
    }
  }

  async function handleResendInvitation(invitationId: string) {
    if (!currentOrg || !token) return;

    try {
      const api = new InvitationsAPI(() => token);
      await api.resendInvitation(currentOrg.id, invitationId);
      toastStore.success('Invitation email resent');
      await loadInvitations();
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to resend invitation';
      toastStore.error(errorMsg);
    }
  }

  async function handleUpdateMemberRole(memberId: string, newRole: OrgRole) {
    if (!currentOrg || !token) return;

    try {
      const api = new OrganizationsAPI(() => token);
      await api.updateMemberRole(currentOrg.id, memberId, newRole);
      toastStore.success('Member role updated');
      await loadMembers();
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to update member role';
      toastStore.error(errorMsg);
    }
  }

  // The ConfirmDialog handlers below toast the error and rethrow so the dialog
  // stays open for a retry.
  async function handleRemoveMember() {
    if (!currentOrg || !token || !memberToRemove) return;
    const target = memberToRemove;

    try {
      const api = new OrganizationsAPI(() => token);
      await api.removeMember(currentOrg.id, target.id);
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to remove member');
      throw e;
    }
    toastStore.success(`${target.user.name} removed from the organization`);
    memberToRemove = null;
    await loadMembers();
  }

  async function handleTransferOwnership() {
    if (!currentOrg || !token || !memberToTransfer) return;
    const orgId = currentOrg.id;
    const target = memberToTransfer;

    try {
      const api = new OrganizationsAPI(() => token);
      await api.transferOwnership(orgId, target.userId);
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to transfer ownership');
      throw e;
    }

    toastStore.success(`Ownership transferred to ${target.user.name}`);
    memberToTransfer = null;

    // The transfer already happened; a failed refresh must not look like a failed transfer.
    try {
      const api = new OrganizationsAPI(() => token);
      const { organizations } = await api.getOrganizations();
      organizationStore.setOrganizations(organizations);
      const fresh = organizations.find((o) => o.id === orgId);
      if (fresh) organizationStore.setCurrentOrganization(fresh);
    } catch (e) {
      console.error('Failed to refresh organizations:', e);
    }
    await loadMembers();
  }

  async function handleLeaveOrganization() {
    if (!currentOrg || !token) return;
    const orgId = currentOrg.id;

    try {
      const api = new OrganizationsAPI(() => token);
      await api.leaveOrganization(orgId);
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to leave organization');
      throw e;
    }

    organizationStore.removeOrganization(orgId);
    toastStore.success('You left the organization');
    goto('/dashboard');
  }

  function getRoleBadgeVariant(role: string): 'default' | 'secondary' | 'outline' {
    if (role === 'owner') return 'default';
    if (role === 'admin') return 'secondary';
    return 'outline';
  }

  function getRoleIcon(role: string) {
    if (role === 'owner') return Crown;
    if (role === 'admin') return Shield;
    return Users;
  }

  function roleIconClass(role: string): string {
    if (role === 'owner') return 'text-warning-text';
    if (role === 'admin') return 'text-info-text';
    return 'text-muted-foreground';
  }

  function formatExpiresIn(date: Date | string): string {
    const d = date instanceof Date ? date : new Date(date);
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (diff < 0) return 'Expired';
    if (days === 0) return `${hours}h left`;
    if (days === 1) return '1 day left';
    return `${days} days left`;
  }

  let isOwner = $derived(currentOrg?.role === 'owner');
  let canManage = $derived(currentOrg ? canManageMembers(currentOrg.role) : false);
  let currentUserId = $derived(user?.id);

  function hasMenuActions(member: OrganizationMemberWithUser): boolean {
    return isOwner || (currentOrg?.role === 'admin' && member.role === 'member');
  }
</script>

<svelte:head>
  <title>Members - LogTide</title>
</svelte:head>

<div class="space-y-6">
  <PageHeader
    title="Members"
    appliesTo="organization"
    description="Manage members and invitations for this organization."
  >
    {#snippet actions()}
      {#if canManage}
        <Button onclick={() => (inviteDialogOpen = true)} class="gap-2">
          <UserPlus class="w-4 h-4" aria-hidden="true" />
          Invite member
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  <Tabs value="members" class="w-full">
    <TabsList class="grid w-full grid-cols-2 mb-4">
      <TabsTrigger value="members">
        Members ({members.length})
      </TabsTrigger>
      {#if canManage}
        <TabsTrigger value="invitations">
          Pending invitations ({pendingInvitations.length})
        </TabsTrigger>
      {:else}
        <TabsTrigger value="invitations" disabled>
          Pending invitations
        </TabsTrigger>
      {/if}
    </TabsList>

    <TabsContent value="members">
      {#if loadingMembers}
        <SkeletonTable rows={5} columns={4} />
      {:else if members.length === 0}
        <div class="text-center py-8">
          <Users class="w-12 h-12 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
          <p class="text-sm text-muted-foreground">No members found</p>
        </div>
      {:else}
        <div class="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                {#if canManage}
                  <TableHead class="w-[80px]">Actions</TableHead>
                {/if}
              </TableRow>
            </TableHeader>
            <TableBody>
              {#each members as member (member.id)}
                {@const RoleIcon = getRoleIcon(member.role)}
                {@const isCurrentUser = member.userId === currentUserId}
                {@const isMemberOwner = member.role === 'owner'}
                <TableRow>
                  <TableCell>
                    <div class="flex items-center gap-3">
                      <Avatar name={member.user.name} email={member.user.email} />
                      <div>
                        <div class="font-medium flex items-center gap-2">
                          {member.user.name}
                          {#if isCurrentUser}
                            <Badge variant="outline" class="text-xs">You</Badge>
                          {/if}
                        </div>
                        <div class="text-sm text-muted-foreground">{member.user.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div class="flex items-center gap-2">
                      <RoleIcon class="w-4 h-4 {roleIconClass(member.role)}" aria-hidden="true" />
                      <Badge variant={getRoleBadgeVariant(member.role)}>
                        {roleLabel(member.role)}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell class="text-sm text-muted-foreground">
                    <Timestamp value={member.createdAt} precision="minute" />
                  </TableCell>
                  {#if canManage}
                    <TableCell>
                      {#if !isMemberOwner && !isCurrentUser && hasMenuActions(member)}
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label="Member actions for {member.user.name}"
                            class={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'h-8 w-8')}
                          >
                            <MoreHorizontal class="w-4 h-4" aria-hidden="true" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {#if isOwner}
                              {#if member.role === 'member'}
                                <DropdownMenuItem onclick={() => handleUpdateMemberRole(member.id, 'admin')}>
                                  <Shield class="w-4 h-4 mr-2" aria-hidden="true" />
                                  Promote to admin
                                </DropdownMenuItem>
                              {:else if member.role === 'admin'}
                                <DropdownMenuItem onclick={() => handleUpdateMemberRole(member.id, 'member')}>
                                  <Users class="w-4 h-4 mr-2" aria-hidden="true" />
                                  Demote to member
                                </DropdownMenuItem>
                              {/if}
                              <DropdownMenuItem
                                onclick={() => {
                                  memberToTransfer = member;
                                  transferOpen = true;
                                }}
                              >
                                <ArrowRightLeft class="w-4 h-4 mr-2" aria-hidden="true" />
                                Transfer ownership
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                            {/if}
                            <DropdownMenuItem
                              onclick={() => {
                                memberToRemove = member;
                                removeOpen = true;
                              }}
                              class="text-destructive focus:text-destructive"
                            >
                              <Trash2 class="w-4 h-4 mr-2" aria-hidden="true" />
                              Remove from organization
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      {:else if isCurrentUser && !isMemberOwner}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Leave organization"
                          onclick={() => (confirmLeaveOpen = true)}
                          class="h-8 w-8 text-muted-foreground hover:text-destructive"
                        >
                          <LogOut class="w-4 h-4" aria-hidden="true" />
                        </Button>
                      {/if}
                    </TableCell>
                  {/if}
                </TableRow>
              {/each}
            </TableBody>
          </Table>
        </div>
      {/if}
    </TabsContent>

    <TabsContent value="invitations">
      {#if loadingInvitations}
        <SkeletonTable rows={3} columns={5} />
      {:else if pendingInvitations.length === 0}
        <div class="text-center py-8">
          <Mail class="w-12 h-12 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
          <p class="text-sm text-muted-foreground">No pending invitations</p>
          <Button onclick={() => (inviteDialogOpen = true)} variant="outline" class="mt-4 gap-2">
            <UserPlus class="w-4 h-4" aria-hidden="true" />
            Invite someone
          </Button>
        </div>
      {:else}
        <div class="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Invited by</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead class="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#each pendingInvitations as invitation (invitation.id)}
                <TableRow>
                  <TableCell>
                    <div class="flex items-center gap-2">
                      <Mail class="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                      <span class="font-medium">{invitation.email}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={getRoleBadgeVariant(invitation.role)}>
                      {roleLabel(invitation.role)}
                    </Badge>
                  </TableCell>
                  <TableCell class="text-sm text-muted-foreground">
                    {invitation.inviterName}
                  </TableCell>
                  <TableCell>
                    <div class="flex items-center gap-1 text-sm text-muted-foreground">
                      <Clock class="w-3 h-3" aria-hidden="true" />
                      {formatExpiresIn(invitation.expiresAt)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div class="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-8 w-8"
                        onclick={() => handleResendInvitation(invitation.id)}
                        aria-label="Resend invitation"
                        title="Resend invitation"
                      >
                        <RefreshCw class="w-4 h-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-8 w-8 text-destructive hover:text-destructive"
                        onclick={() => handleRevokeInvitation(invitation.id)}
                        aria-label="Revoke invitation"
                        title="Revoke invitation"
                      >
                        <X class="w-4 h-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              {/each}
            </TableBody>
          </Table>
        </div>
      {/if}
    </TabsContent>
  </Tabs>

  <details class="group rounded-lg border border-border bg-card" data-testid="role-help">
    <summary class="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
      <ChevronRight class="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden="true" />
      What each role can do
    </summary>
    <div class="px-4 pb-4">
      <RoleCapabilitiesTable />
    </div>
  </details>
</div>

<InviteMemberDialog bind:open={inviteDialogOpen} onSubmit={handleInvite} inviterRole={currentOrg?.role ?? null} />

<ConfirmDialog
  bind:open={removeOpen}
  title="Remove member"
  description={`${memberToRemove?.user.name ?? 'This member'} will lose access to all projects and data immediately.`}
  confirmLabel="Remove member"
  onConfirm={handleRemoveMember}
/>

<ConfirmDialog
  bind:open={transferOpen}
  title="Transfer ownership"
  description={`You will become an admin. ${memberToTransfer?.user.name ?? 'The new owner'} becomes the owner and only they can transfer ownership again.`}
  confirmLabel="Transfer ownership"
  requireText={currentOrg?.name}
  onConfirm={handleTransferOwnership}
/>

<ConfirmDialog
  bind:open={confirmLeaveOpen}
  title="Leave organization"
  description={`You will lose access to ${currentOrg?.name ?? 'this organization'} and all its data immediately. To rejoin, you need to be invited again.`}
  confirmLabel="Leave organization"
  onConfirm={handleLeaveOrganization}
/>
