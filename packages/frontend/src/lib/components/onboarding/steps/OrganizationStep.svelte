<script lang="ts">
  import { onboardingStore } from '$lib/stores/onboarding';
  import { authStore } from '$lib/stores/auth';
  import { organizationStore } from '$lib/stores/organization';
  import { OrganizationsAPI } from '$lib/api/organizations';
  import { toastStore } from '$lib/stores/toast';
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { fly } from 'svelte/transition';
  import Building2 from '@lucide/svelte/icons/building-2';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Lightbulb from '@lucide/svelte/icons/lightbulb';

  let isLoading = $state(false);
  let orgName = $state('');
  let orgSlug = $state('');
  let orgDescription = $state('');
  let token = $state<string | null>(null);
  let organizationsAPI = $derived(new OrganizationsAPI(() => token));

  let isFormValid = $derived(orgName.trim().length > 0);

  authStore.subscribe((state) => {
    token = state.token;
  });

  // Domain-based suggestions
  let userEmail = $derived($authStore.user?.email || '');
  let emailDomain = $derived(() => {
    const match = userEmail.match(/@([^.]+)\./);
    return match ? match[1] : '';
  });

  let suggestions = $derived(() => {
    const domain = emailDomain();
    if (!domain || domain === 'gmail' || domain === 'hotmail' || domain === 'yahoo' || domain === 'outlook') {
      return ['My Company', 'Production', 'Development Team'];
    }
    // Capitalize first letter of domain
    const capitalizedDomain = domain.charAt(0).toUpperCase() + domain.slice(1);
    return [capitalizedDomain, `${capitalizedDomain} Production`, `${capitalizedDomain} Development`];
  });

  $effect(() => {
    if (orgName) {
      orgSlug = orgName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    } else {
      orgSlug = '';
    }
  });

  function selectSuggestion(suggestion: string) {
    orgName = suggestion;
  }

  async function handleSubmit() {
    if (!orgName.trim()) {
      toastStore.error('Organization name is required');
      return;
    }

    isLoading = true;

    try {
      const newOrg = await organizationStore.createOrganization(async () => {
        const response = await organizationsAPI.createOrganization({
          name: orgName.trim(),
          description: orgDescription.trim() || undefined,
        });
        return response.organization;
      });

      onboardingStore.setOrganizationId(newOrg.id);
      toastStore.success('Organization created!');
      onboardingStore.completeStep('create-organization');
    } catch (error: any) {
      console.error('Failed to create organization:', error);
      toastStore.error(error.message || 'Failed to create organization');
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="space-y-6" in:fly={{ y: 20, duration: 400 }}>
  <div class="text-center space-y-2">
    <div class="w-16 h-16 mx-auto bg-primary/10 rounded-2xl flex items-center justify-center">
      <Building2 class="w-8 h-8 text-primary" />
    </div>
    <h2 class="text-2xl font-bold">Create Your Organization</h2>
    <p class="text-muted-foreground max-w-md mx-auto">
      Organizations help you separate logs by team, client, or environment. You can create more later.
    </p>
  </div>

  <!-- Quick suggestions -->
  <Card class="bg-primary/5 border-primary/20">
    <CardContent class="pt-4">
      <div class="flex items-start gap-2">
        <Lightbulb class="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
        <div class="space-y-2">
          <p class="text-sm font-medium">Quick suggestions</p>
          <div class="flex flex-wrap gap-2">
            {#each suggestions() as suggestion}
              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-background border rounded-md hover:bg-accent transition-colors"
                onclick={() => selectSuggestion(suggestion)}
              >
                {suggestion}
              </button>
            {/each}
          </div>
        </div>
      </div>
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <CardTitle class="text-lg">Organization Details</CardTitle>
      <CardDescription>Enter a name for your organization</CardDescription>
    </CardHeader>
    <CardContent>
      <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-4">
        <div class="space-y-2">
          <Label for="org-name">
            Organization Name <span class="text-destructive">*</span>
          </Label>
          <Input
            id="org-name"
            type="text"
            placeholder="e.g., Acme Corp, My Startup"
            bind:value={orgName}
            disabled={isLoading}
            required
            autofocus
          />
        </div>

        {#if orgSlug}
          <div class="space-y-2">
            <Label>Organization Slug</Label>
            <div class="px-3 py-2 bg-muted rounded-md text-sm font-mono text-muted-foreground">
              {orgSlug}
            </div>
            <p class="text-xs text-muted-foreground">
              Auto-generated identifier for your organization
            </p>
          </div>
        {/if}

        <div class="space-y-2">
          <Label for="org-description">Description (optional)</Label>
          <Textarea
            id="org-description"
            placeholder="What is this organization for?"
            bind:value={orgDescription}
            disabled={isLoading}
            rows={2}
          />
        </div>

        <Button
          type="submit"
          disabled={isLoading || !isFormValid}
          class="w-full gap-2"
        >
          {#if isLoading}
            <Spinner size="sm" />
            Creating...
          {:else}
            Create Organization
            <ChevronRight class="w-4 h-4" />
          {/if}
        </Button>
      </form>
    </CardContent>
  </Card>
</div>
