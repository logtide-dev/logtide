<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { organizationStore } from '$lib/stores/organization';
  import { toastStore } from '$lib/stores/toast';
  import { OrganizationsAPI } from '$lib/api/organizations';
  import { InvitationsAPI } from '$lib/api/invitations';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Separator } from '$lib/components/ui/separator';
  import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '$lib/components/ui/select';
  import type { OrganizationWithRole, OrganizationMemberWithUser, PendingInvitation, OrgRole } from '@logward/shared';
  import { canManageMembers } from '@logward/shared';
  import { Badge } from '$lib/components/ui/badge';
  import Building2 from '@lucide/svelte/icons/building-2';
  import Save from '@lucide/svelte/icons/save';
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
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from '$lib/components/ui/table';
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
  } from '$lib/components/ui/alert-dialog';
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
  } from '$lib/components/ui/dropdown-menu';
  import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
  import InviteMemberDialog from '$lib/components/InviteMemberDialog.svelte';
  import Spinner from '$lib/components/Spinner.svelte';

  let user: any = null;
  let token: string | null = null;
  let currentOrg = $state<OrganizationWithRole | null>(null);
  let saving = $state(false);
  let deleting = $state(false);

  let orgName = $state('');
  let orgSlug = $state('');
  let orgDescription = $state('');

  let members = $state<OrganizationMemberWithUser[]>([]);
  let pendingInvitations = $state<PendingInvitation[]>([]);
  let loadingMembers = $state(false);
  let loadingInvitations = $state(false);
  let inviteDialogOpen = $state(false);

  // For confirming member removal
  let memberToRemove = $state<OrganizationMemberWithUser | null>(null);
  let removingMember = $state(false);

  // For confirming leaving org
  let confirmLeaveOpen = $state(false);
  let leavingOrg = $state(false);

  authStore.subscribe((state) => {
    user = state.user;
    token = state.token;
  });

  organizationStore.subscribe((state) => {
    currentOrg = state.currentOrganization;
    if (currentOrg) {
      orgName = currentOrg.name;
      orgSlug = currentOrg.slug;
      orgDescription = currentOrg.description || '';
      loadMembers();
      loadInvitations();
    }
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

  async function saveOrganization() {
    if (!currentOrg || !token) {
      toastStore.error('No organization selected');
      return;
    }

    if (currentOrg.role !== 'owner') {
      toastStore.error('Only the organization owner can update settings');
      return;
    }

    saving = true;
    try {
      const api = new OrganizationsAPI(() => token);
      const response = await api.updateOrganization(currentOrg.id, {
        name: orgName,
        description: orgDescription || undefined,
      });

      organizationStore.updateOrganization(response.organization.id, response.organization);

      orgSlug = response.organization.slug;

      toastStore.success('Organization settings updated successfully');
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to update organization settings';
      toastStore.error(errorMsg);
    } finally {
      saving = false;
    }
  }

  async function deleteOrganization() {
    if (!currentOrg || !token) return;

    if (currentOrg.role !== 'owner') {
      toastStore.error('Only the organization owner can delete the organization');
      return;
    }

    deleting = true;
    try {
      const api = new OrganizationsAPI(() => token);
      await api.deleteOrganization(currentOrg.id);

      organizationStore.removeOrganization(currentOrg.id);

      toastStore.success('Organization deleted successfully');
      goto('/dashboard');
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to delete organization';
      toastStore.error(errorMsg);
    } finally {
      deleting = false;
    }
  }

  async function handleInvite(data: { email: string; role: OrgRole }) {
    if (!currentOrg || !token) throw new Error('No organization selected');

    const api = new InvitationsAPI(() => token);
    const result = await api.inviteUser(currentOrg.id, data);

    // Reload both members and invitations
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

  async function handleRemoveMember() {
    if (!currentOrg || !token || !memberToRemove) return;

    removingMember = true;
    try {
      const api = new OrganizationsAPI(() => token);
      await api.removeMember(currentOrg.id, memberToRemove.id);
      toastStore.success(`${memberToRemove.user.name} has been removed from the organization`);
      memberToRemove = null;
      await loadMembers();
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to remove member';
      toastStore.error(errorMsg);
    } finally {
      removingMember = false;
    }
  }

  async function handleLeaveOrganization() {
    if (!currentOrg || !token) return;

    leavingOrg = true;
    try {
      const api = new OrganizationsAPI(() => token);
      await api.leaveOrganization(currentOrg.id);

      organizationStore.removeOrganization(currentOrg.id);

      toastStore.success('You have left the organization');
      goto('/dashboard');
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to leave organization';
      toastStore.error(errorMsg);
    } finally {
      leavingOrg = false;
      confirmLeaveOpen = false;
    }
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

  function formatTimeAgo(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  }

  function formatExpiresIn(date: Date): string {
    const now = new Date();
    const diff = date.getTime() - now.getTime();
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
</script>

<svelte:head>
  <title>Organization Settings - LogWard</title>
</svelte:head>

<div class="container mx-auto space-y-6 p-6">
  <div>
    <h1 class="text-3xl font-bold tracking-tight">Organization Settings</h1>
    <div class="flex items-center gap-2 mt-2">
      <Building2 class="w-4 h-4 text-muted-foreground" />
      <p class="text-muted-foreground">
        Manage settings for {currentOrg?.name || 'your organization'}
      </p>
    </div>
  </div>

  <Card>
    <CardHeader>
      <CardTitle>Organization Information</CardTitle>
      <CardDescription>Update your organization details</CardDescription>
    </CardHeader>
    <CardContent>
      <form onsubmit={(e) => { e.preventDefault(); saveOrganization(); }} class="space-y-4">
        <div class="space-y-2">
          <Label for="org-name">Organization Name</Label>
          <Input
            id="org-name"
            type="text"
            placeholder="My Organization"
            bind:value={orgName}
            disabled={saving || !isOwner}
            required
          />
          {#if !isOwner}
            <p class="text-sm text-muted-foreground">Only the owner can edit the organization name</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="org-slug">Slug (URL-friendly identifier)</Label>
          <Input
            id="org-slug"
            type="text"
            value={orgSlug}
            disabled
            class="bg-muted"
          />
          <p class="text-sm text-muted-foreground">
            Auto-generated from organization name. This cannot be edited manually.
          </p>
        </div>

        <div class="space-y-2">
          <Label for="org-description">Description</Label>
          <Textarea
            id="org-description"
            placeholder="A brief description of your organization"
            bind:value={orgDescription}
            disabled={saving || !isOwner}
            rows={3}
          />
        </div>

        <Separator />

        <Button type="submit" disabled={saving || !isOwner} class="gap-2">
          <Save class="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </form>
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Users class="w-5 h-5 text-primary" />
          <div>
            <CardTitle>Team Members</CardTitle>
            <CardDescription>Manage members and invitations for this organization</CardDescription>
          </div>
        </div>
        {#if canManage}
          <Button onclick={() => inviteDialogOpen = true} class="gap-2">
            <UserPlus class="w-4 h-4" />
            Invite Member
          </Button>
        {/if}
      </div>
    </CardHeader>
    <CardContent>
      <Tabs value="members" class="w-full">
        <TabsList class="grid w-full grid-cols-2 mb-4">
          <TabsTrigger value="members">
            Members ({members.length})
          </TabsTrigger>
          {#if canManage}
            <TabsTrigger value="invitations">
              Pending Invitations ({pendingInvitations.length})
            </TabsTrigger>
          {:else}
            <TabsTrigger value="invitations" disabled>
              Pending Invitations
            </TabsTrigger>
          {/if}
        </TabsList>

        <TabsContent value="members">
          {#if loadingMembers}
            <div class="flex items-center justify-center py-8">
              <Spinner size="md" />
              <span class="ml-2 text-sm text-muted-foreground">Loading members...</span>
            </div>
          {:else if members.length === 0}
            <div class="text-center py-8">
              <Users class="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
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
                  {#each members as member}
                    {@const RoleIcon = getRoleIcon(member.role)}
                    {@const isCurrentUser = member.userId === currentUserId}
                    {@const isMemberOwner = member.role === 'owner'}
                    <TableRow>
                      <TableCell>
                        <div class="flex items-center gap-3">
                          <div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <span class="text-sm font-medium text-primary">
                              {member.user.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
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
                          <RoleIcon class="w-4 h-4 {member.role === 'owner' ? 'text-yellow-500' : member.role === 'admin' ? 'text-blue-500' : 'text-muted-foreground'}" />
                          <Badge variant={getRoleBadgeVariant(member.role)}>
                            {member.role}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell class="text-sm text-muted-foreground">
                        {formatTimeAgo(member.createdAt)}
                      </TableCell>
                      {#if canManage}
                        <TableCell>
                          {#if !isMemberOwner && !isCurrentUser}
                            <DropdownMenu>
                              <DropdownMenuTrigger>
                                <Button variant="ghost" size="icon" class="h-8 w-8">
                                  <MoreHorizontal class="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {#if isOwner}
                                  {#if member.role === 'member'}
                                    <DropdownMenuItem onclick={() => handleUpdateMemberRole(member.id, 'admin')}>
                                      <Shield class="w-4 h-4 mr-2" />
                                      Promote to Admin
                                    </DropdownMenuItem>
                                  {:else if member.role === 'admin'}
                                    <DropdownMenuItem onclick={() => handleUpdateMemberRole(member.id, 'member')}>
                                      <Users class="w-4 h-4 mr-2" />
                                      Demote to Member
                                    </DropdownMenuItem>
                                  {/if}
                                  <DropdownMenuSeparator />
                                {/if}
                                {#if isOwner || (currentOrg?.role === 'admin' && member.role === 'member')}
                                  <DropdownMenuItem
                                    onclick={() => memberToRemove = member}
                                    class="text-destructive focus:text-destructive"
                                  >
                                    <Trash2 class="w-4 h-4 mr-2" />
                                    Remove from Organization
                                  </DropdownMenuItem>
                                {/if}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          {:else if isCurrentUser && !isMemberOwner}
                            <Button
                              variant="ghost"
                              size="sm"
                              onclick={() => confirmLeaveOpen = true}
                              class="text-muted-foreground hover:text-destructive"
                            >
                              <LogOut class="w-4 h-4" />
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
            <div class="flex items-center justify-center py-8">
              <Spinner size="md" />
              <span class="ml-2 text-sm text-muted-foreground">Loading invitations...</span>
            </div>
          {:else if pendingInvitations.length === 0}
            <div class="text-center py-8">
              <Mail class="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p class="text-sm text-muted-foreground">No pending invitations</p>
              <Button onclick={() => inviteDialogOpen = true} variant="outline" class="mt-4 gap-2">
                <UserPlus class="w-4 h-4" />
                Invite Someone
              </Button>
            </div>
          {:else}
            <div class="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Invited By</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead class="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {#each pendingInvitations as invitation}
                    <TableRow>
                      <TableCell>
                        <div class="flex items-center gap-2">
                          <Mail class="w-4 h-4 text-muted-foreground" />
                          <span class="font-medium">{invitation.email}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getRoleBadgeVariant(invitation.role)}>
                          {invitation.role}
                        </Badge>
                      </TableCell>
                      <TableCell class="text-sm text-muted-foreground">
                        {invitation.inviterName}
                      </TableCell>
                      <TableCell>
                        <div class="flex items-center gap-1 text-sm text-muted-foreground">
                          <Clock class="w-3 h-3" />
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
                            title="Resend invitation"
                          >
                            <RefreshCw class="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            class="h-8 w-8 text-destructive hover:text-destructive"
                            onclick={() => handleRevokeInvitation(invitation.id)}
                            title="Revoke invitation"
                          >
                            <X class="w-4 h-4" />
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
    </CardContent>
  </Card>

  {#if isOwner}
    <Card class="border-destructive">
      <CardHeader>
        <CardTitle class="text-destructive">Danger Zone</CardTitle>
        <CardDescription>Irreversible and destructive actions</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex items-start justify-between gap-4">
          <div>
            <h4 class="font-medium mb-1">Delete Organization</h4>
            <p class="text-sm text-muted-foreground">
              Permanently delete this organization and all associated projects and logs. This action cannot be undone.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-destructive text-destructive-foreground hover:bg-destructive/90 h-10 px-4 py-2 flex-shrink-0">
              <Trash2 class="w-4 h-4" />
              Delete
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Organization?</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete <strong>{currentOrg?.name}</strong>?
                  This will permanently delete:
                  <ul class="list-disc list-inside mt-2 space-y-1">
                    <li>All projects in this organization</li>
                    <li>All logs and data</li>
                    <li>All members will lose access</li>
                  </ul>
                  <p class="mt-4 font-semibold text-destructive">This action cannot be undone!</p>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onclick={deleteOrganization}
                  class="bg-destructive hover:bg-destructive/90"
                >
                  {deleting ? 'Deleting...' : 'Delete Organization'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  {/if}
</div>

<!-- Invite Member Dialog -->
<InviteMemberDialog bind:open={inviteDialogOpen} onSubmit={handleInvite} />

<!-- Remove Member Confirmation Dialog -->
<AlertDialog open={!!memberToRemove} onOpenChange={(open) => { if (!open) memberToRemove = null; }}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Remove Member?</AlertDialogTitle>
      <AlertDialogDescription>
        Are you sure you want to remove <strong>{memberToRemove?.user.name}</strong> from this organization?
        They will lose access to all projects and data immediately.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel onclick={() => memberToRemove = null}>Cancel</AlertDialogCancel>
      <AlertDialogAction
        onclick={handleRemoveMember}
        class="bg-destructive hover:bg-destructive/90"
        disabled={removingMember}
      >
        {removingMember ? 'Removing...' : 'Remove Member'}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>

<!-- Leave Organization Confirmation Dialog -->
<AlertDialog bind:open={confirmLeaveOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Leave Organization?</AlertDialogTitle>
      <AlertDialogDescription>
        Are you sure you want to leave <strong>{currentOrg?.name}</strong>?
        You will lose access to all projects and data immediately. To rejoin, you'll need to be invited again.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        onclick={handleLeaveOrganization}
        class="bg-destructive hover:bg-destructive/90"
        disabled={leavingOrg}
      >
        {leavingOrg ? 'Leaving...' : 'Leave Organization'}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
