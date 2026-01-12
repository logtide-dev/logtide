<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { organizationStore } from '$lib/stores/organization';
  import { InvitationsAPI } from '$lib/api/invitations';
  import { OrganizationsAPI } from '$lib/api/organizations';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import Spinner from '$lib/components/Spinner.svelte';
  import Building2 from '@lucide/svelte/icons/building-2';
  import Users from '@lucide/svelte/icons/users';
  import Shield from '@lucide/svelte/icons/shield';
  import Clock from '@lucide/svelte/icons/clock';
  import CheckCircle from '@lucide/svelte/icons/check-circle';
  import XCircle from '@lucide/svelte/icons/x-circle';
  import AlertCircle from '@lucide/svelte/icons/alert-circle';
  import LogIn from '@lucide/svelte/icons/log-in';

  interface InvitationPreview {
    email: string;
    role: string;
    organizationName: string;
    inviterName: string;
    expiresAt: Date;
  }

  let token = $derived($page.params.token);
  let user = $state<any>(null);
  let authToken = $state<string | null>(null);

  let loading = $state(true);
  let accepting = $state(false);
  let invitation = $state<InvitationPreview | null>(null);
  let error = $state<string | null>(null);
  let success = $state(false);
  let acceptedOrgId = $state<string | null>(null);

  authStore.subscribe((state) => {
    user = state.user;
    authToken = state.token;
  });

  onMount(async () => {
    await loadInvitation();
  });

  async function loadInvitation() {
    loading = true;
    error = null;

    try {
      const api = new InvitationsAPI(() => authToken);
      invitation = await api.getInvitationByToken(token);
    } catch (e) {
      if (e instanceof Error) {
        if (e.message.includes('not found') || e.message.includes('expired')) {
          error = 'This invitation is invalid or has expired.';
        } else {
          error = e.message;
        }
      } else {
        error = 'Failed to load invitation details.';
      }
    } finally {
      loading = false;
    }
  }

  async function acceptInvitation() {
    if (!authToken) {
      // Redirect to login with return URL
      goto(`/login?redirect=/invite/${token}`);
      return;
    }

    accepting = true;
    error = null;

    try {
      const api = new InvitationsAPI(() => authToken);
      const result = await api.acceptInvitation(token);

      success = true;
      acceptedOrgId = result.organizationId;

      // Reload organizations to include the new one
      const orgsApi = new OrganizationsAPI(() => authToken);
      await organizationStore.fetchOrganizations(async () => {
        const response = await orgsApi.getOrganizations();
        return response.organizations;
      });

      // Set the new organization as current
      organizationStore.setCurrentOrganization(result.organizationId);

      // Redirect to dashboard after short delay
      setTimeout(() => {
        goto('/dashboard');
      }, 2000);
    } catch (e) {
      if (e instanceof Error) {
        error = e.message;
      } else {
        error = 'Failed to accept invitation.';
      }
    } finally {
      accepting = false;
    }
  }

  function formatExpiresIn(date: Date): string {
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (diff < 0) return 'Expired';
    if (days === 0) {
      if (hours === 0) return 'Less than an hour';
      return `${hours} hour${hours === 1 ? '' : 's'}`;
    }
    if (days === 1) return '1 day';
    return `${days} days`;
  }

  let isLoggedIn = $derived(!!authToken);
  let emailMismatch = $derived(
    isLoggedIn && invitation && user?.email?.toLowerCase() !== invitation.email.toLowerCase()
  );
</script>

<svelte:head>
  <title>Accept Invitation - LogTide</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30 p-4">
  <div class="w-full max-w-md">
    {#if loading}
      <Card>
        <CardContent class="flex flex-col items-center justify-center py-12">
          <Spinner size="lg" />
          <p class="mt-4 text-muted-foreground">Loading invitation...</p>
        </CardContent>
      </Card>
    {:else if error && !invitation}
      <Card class="border-destructive/50">
        <CardHeader class="text-center">
          <div class="mx-auto mb-4 w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <XCircle class="w-6 h-6 text-destructive" />
          </div>
          <CardTitle>Invitation Not Found</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardFooter class="flex justify-center mt-4">
          <Button onclick={() => goto('/login')} variant="outline">
            Go to Login
          </Button>
        </CardFooter>
      </Card>
    {:else if success}
      <Card class="border-green-500/50">
        <CardHeader class="text-center">
          <div class="mx-auto mb-4 w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
            <CheckCircle class="w-6 h-6 text-green-500" />
          </div>
          <CardTitle>Welcome to {invitation?.organizationName}!</CardTitle>
          <CardDescription>
            You've successfully joined the organization. Redirecting you to the dashboard...
          </CardDescription>
        </CardHeader>
        <CardContent class="flex justify-center">
          <Spinner size="sm" />
        </CardContent>
      </Card>
    {:else if invitation}
      <Card>
        <CardHeader class="text-center">
          <div class="mx-auto mb-4 w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Building2 class="w-8 h-8 text-primary" />
          </div>
          <CardTitle class="text-2xl">You're Invited!</CardTitle>
          <CardDescription>
            <span class="font-medium text-foreground">{invitation.inviterName}</span> has invited you to join
          </CardDescription>
        </CardHeader>

        <CardContent class="space-y-6">
          <div class="text-center">
            <h3 class="text-xl font-semibold">{invitation.organizationName}</h3>
          </div>

          <div class="grid gap-4">
            <div class="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div class="flex items-center gap-2 text-sm text-muted-foreground">
                <Shield class="w-4 h-4" />
                <span>Your role</span>
              </div>
              <Badge variant={invitation.role === 'admin' ? 'secondary' : 'outline'}>
                {invitation.role}
              </Badge>
            </div>

            <div class="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div class="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock class="w-4 h-4" />
                <span>Expires in</span>
              </div>
              <span class="text-sm font-medium">{formatExpiresIn(invitation.expiresAt)}</span>
            </div>
          </div>

          {#if emailMismatch}
            <div class="flex items-start gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <AlertCircle class="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div class="text-sm mt-4">
                <p class="font-medium text-yellow-600 dark:text-yellow-400">Email Mismatch</p>
                <p class="text-muted-foreground mt-1">
                  This invitation was sent to <strong>{invitation.email}</strong>, but you're logged in as <strong>{user?.email}</strong>.
                </p>
                <p class="text-muted-foreground mt-1">
                  Please log out and log in with the correct account to accept this invitation.
                </p>
              </div>
            </div>
          {/if}

          {#if error}
            <div class="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
              <XCircle class="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div class="text-sm mt-4">
                <p class="font-medium text-destructive">Error</p>
                <p class="text-muted-foreground mt-1">{error}</p>
              </div>
            </div>
          {/if}
        </CardContent>

        <CardFooter class="flex flex-col gap-3">
          {#if !isLoggedIn}
            <Button onclick={acceptInvitation} class="w-full gap-2" size="lg">
              <LogIn class="w-4 h-4" />
              Log In to Accept
            </Button>
            <p class="text-sm text-center text-muted-foreground">
              Don't have an account?{' '}
              <a href="/register?redirect=/invite/{token}" class="text-primary hover:underline">
                Register here
              </a>
            </p>
          {:else if emailMismatch}
            <Button
              onclick={() => {
                authStore.logout();
                goto(`/login?redirect=/invite/${token}`);
              }}
              variant="outline"
              class="w-full"
            >
              Log Out and Switch Account
            </Button>
          {:else}
            <Button
              onclick={acceptInvitation}
              disabled={accepting}
              class="w-full gap-2"
              size="lg"
            >
              {#if accepting}
                <Spinner size="sm" />
                Joining...
              {:else}
                <Users class="w-4 h-4" />
                Accept Invitation
              {/if}
            </Button>
          {/if}

          <Button onclick={() => goto('/')} variant="ghost" class="w-full">
            Maybe Later
          </Button>
        </CardFooter>
      </Card>
    {/if}
  </div>
</div>
