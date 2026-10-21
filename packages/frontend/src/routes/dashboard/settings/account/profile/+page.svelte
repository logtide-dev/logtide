<script lang="ts">
  import { onDestroy } from 'svelte';
  import { authStore } from '$lib/stores/auth';
  import { toastStore } from '$lib/stores/toast';
  import { UsersAPI } from '$lib/api/users';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import SettingsSection from '$lib/components/app/SettingsSection.svelte';
  import Save from '@lucide/svelte/icons/save';

  let token = $state<string | null>(null);
  let saving = $state(false);
  let name = $state('');
  let email = $state('');

  const unsubAuthStore = authStore.subscribe((state) => {
    token = state.token;
    if (state.user) {
      name = state.user.name || '';
      email = state.user.email || '';
    }
  });

  onDestroy(() => {
    unsubAuthStore();
  });

  async function saveProfile() {
    if (!token) {
      toastStore.error('Not authenticated');
      return;
    }
    saving = true;
    try {
      const api = new UsersAPI(() => token);
      const response = await api.updateCurrentUser({ name, email });
      authStore.updateUser(response.user);
      toastStore.success('Profile updated');
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to update profile');
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>Profile - LogTide</title>
</svelte:head>

<div class="space-y-6">
  <PageHeader
    title="Profile"
    appliesTo="you"
    description="Your name and email, shown across the app."
  />

  <SettingsSection title="Profile information" description="Name and email shown across the app">
    <form
      class="space-y-4"
      onsubmit={(e) => {
        e.preventDefault();
        saveProfile();
      }}
    >
      <div class="space-y-2">
        <Label for="name">Name</Label>
        <Input id="name" type="text" placeholder="Your name" bind:value={name} disabled={saving} required />
      </div>
      <div class="space-y-2">
        <Label for="email">Email</Label>
        <Input id="email" type="email" placeholder="your@email.com" bind:value={email} disabled={saving} required />
      </div>
      <Button type="submit" disabled={saving} class="gap-2">
        <Save class="w-4 h-4" aria-hidden="true" />
        {saving ? 'Saving...' : 'Save changes'}
      </Button>
    </form>
  </SettingsSection>
</div>
