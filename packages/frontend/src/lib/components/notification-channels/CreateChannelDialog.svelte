<script lang="ts">
	import { notificationChannelsStore } from '$lib/stores/notification-channels';
	import { organizationStore } from '$lib/stores/organization';
	import { toastStore } from '$lib/stores/toast';
	import * as Dialog from '$lib/components/ui/dialog';
	import Button from '$lib/components/ui/button/button.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import Textarea from '$lib/components/ui/textarea/textarea.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import type {
		NotificationChannel,
		NotificationChannelType,
		EmailChannelConfig,
		WebhookChannelConfig,
	} from '$lib/api/notification-channels';
	import { isDiscordWebhookUrl } from '@logtide/shared';
	import Mail from '@lucide/svelte/icons/mail';
	import Webhook from '@lucide/svelte/icons/webhook';
	import TestTube from '@lucide/svelte/icons/test-tube';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';

	interface Props {
		open: boolean;
		channel?: NotificationChannel | null;
		onSuccess?: (channel: NotificationChannel) => void;
		onOpenChange?: (open: boolean) => void;
	}

	let {
		open = $bindable(),
		channel = null,
		onSuccess,
		onOpenChange,
	}: Props = $props();

	let currentOrg = $state<{ id: string } | null>(null);
	organizationStore.subscribe((state) => {
		currentOrg = state.currentOrganization;
	});

	let submitting = $state(false);
	let testing = $state(false);
	let testResult = $state<{ success: boolean; error?: string } | null>(null);

	// Form state
	let name = $state('');
	let description = $state('');
	let channelType = $state<NotificationChannelType>('email');

	// Email config
	let emailRecipients = $state('');

	// Webhook config
	let webhookUrl = $state('');
	let webhookMethod = $state<'POST' | 'PUT'>('POST');
	let webhookHeaders = $state('');
	let webhookAuthType = $state<'none' | 'bearer' | 'basic'>('none');
	let webhookAuthToken = $state('');
	let webhookAuthUser = $state('');
	let webhookAuthPass = $state('');
	// Whether the channel being edited already has a stored secret. Secrets are
	// never sent back to the client, so on edit we keep the secret fields empty
	// and only submit a new value when the user types one.
	let hasStoredAuthSecret = $state(false);

	const isEditing = $derived(!!channel);
	// Discord rejects the raw event envelope, so the backend sends an embed to
	// these URLs instead. Surfacing it here keeps the payload change discoverable.
	const isDiscordUrl = $derived(isDiscordWebhookUrl(webhookUrl));

	function resetForm() {
		name = '';
		description = '';
		channelType = 'email';
		emailRecipients = '';
		webhookUrl = '';
		webhookMethod = 'POST';
		webhookHeaders = '';
		webhookAuthType = 'none';
		webhookAuthToken = '';
		webhookAuthUser = '';
		webhookAuthPass = '';
		hasStoredAuthSecret = false;
		testResult = null;
	}

	function populateForm(ch: NotificationChannel) {
		name = ch.name;
		description = ch.description || '';
		channelType = ch.type;

		if (ch.type === 'email') {
			const config = ch.config as EmailChannelConfig;
			emailRecipients = config.recipients.join(', ');
		} else if (ch.type === 'webhook') {
			const config = ch.config as WebhookChannelConfig;
			webhookUrl = config.url;
			webhookMethod = config.method === 'PUT' ? 'PUT' : 'POST';
			webhookHeaders = config.headers ? JSON.stringify(config.headers, null, 2) : '';
			// Never re-hydrate stored secrets into the DOM. Track that a secret
			// exists so we can show a placeholder, and leave the secret fields
			// empty; a blank value on submit means "keep the existing secret".
			if (config.auth?.type === 'bearer') {
				webhookAuthType = 'bearer';
				webhookAuthToken = '';
				hasStoredAuthSecret = true;
			} else if (config.auth?.type === 'basic') {
				webhookAuthType = 'basic';
				webhookAuthUser = config.auth.username;
				webhookAuthPass = '';
				hasStoredAuthSecret = true;
			} else {
				webhookAuthType = 'none';
				hasStoredAuthSecret = false;
			}
		}
	}

	$effect(() => {
		if (open && channel) {
			populateForm(channel);
		} else if (!open) {
			resetForm();
		}
	});

	function buildConfig(): EmailChannelConfig | WebhookChannelConfig {
		if (channelType === 'email') {
			const recipients = emailRecipients
				.split(',')
				.map((e) => e.trim())
				.filter((e) => e);
			return { recipients };
		} else {
			const config: WebhookChannelConfig = {
				url: webhookUrl.trim(),
				method: webhookMethod,
			};

			if (webhookHeaders.trim()) {
				try {
					config.headers = JSON.parse(webhookHeaders);
				} catch {
					// ignore invalid JSON
				}
			}

			if (webhookAuthType === 'bearer') {
				// Only send a token when the user typed a new one. On edit, a
				// blank field means "keep the existing secret" (the stored secret
				// is never sent to the client), so we omit auth and let the
				// backend preserve it.
				if (webhookAuthToken) {
					config.auth = { type: 'bearer', token: webhookAuthToken };
				}
			} else if (webhookAuthType === 'basic' && webhookAuthUser) {
				const basicAuth: { type: 'basic'; username: string; password?: string } = {
					type: 'basic',
					username: webhookAuthUser,
				};
				// Same rule for the password: only send a new one when typed.
				if (webhookAuthPass) {
					basicAuth.password = webhookAuthPass;
				}
				config.auth = basicAuth;
			}

			return config;
		}
	}

	function validate(): string | null {
		if (!name.trim()) return 'Channel name is required';

		if (channelType === 'email') {
			const recipients = emailRecipients
				.split(',')
				.map((e) => e.trim())
				.filter((e) => e);
			if (recipients.length === 0) return 'At least one email recipient is required';

			const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
			const invalid = recipients.filter((e) => !emailRegex.test(e));
			if (invalid.length > 0) return `Invalid email: ${invalid[0]}`;
		} else {
			if (!webhookUrl.trim()) return 'Webhook URL is required';
			try {
				new URL(webhookUrl);
			} catch {
				return 'Invalid webhook URL';
			}
			if (webhookHeaders.trim()) {
				try {
					JSON.parse(webhookHeaders);
				} catch {
					return 'Custom headers must be valid JSON';
				}
			}
		}

		return null;
	}

	async function handleTest() {
		if (!currentOrg || !channel) return;

		const error = validate();
		if (error) {
			toastStore.error(error);
			return;
		}

		testing = true;
		testResult = null;

		try {
			const result = await notificationChannelsStore.test(channel.id, currentOrg.id);
			testResult = result;
			if (result.success) {
				toastStore.success('Test notification sent successfully');
			} else {
				toastStore.error(result.error || 'Test failed');
			}
		} catch (err) {
			testResult = { success: false, error: err instanceof Error ? err.message : 'Test failed' };
			toastStore.error(testResult.error || 'Test failed');
		} finally {
			testing = false;
		}
	}

	async function handleSubmit() {
		if (!currentOrg) {
			toastStore.error('No organization selected');
			return;
		}

		const error = validate();
		if (error) {
			toastStore.error(error);
			return;
		}

		submitting = true;

		try {
			const config = buildConfig();
			let result: NotificationChannel;

			if (isEditing && channel) {
				result = await notificationChannelsStore.update(channel.id, currentOrg.id, {
					name: name.trim(),
					description: description.trim() || null,
					config,
				});
				toastStore.success('Channel updated');
			} else {
				result = await notificationChannelsStore.create(currentOrg.id, {
					name: name.trim(),
					type: channelType,
					config,
					description: description.trim() || undefined,
				});
				toastStore.success('Channel created');
			}

			resetForm();
			open = false;
			onSuccess?.(result);
		} catch (err) {
			toastStore.error(err instanceof Error ? err.message : 'Failed to save channel');
		} finally {
			submitting = false;
		}
	}
</script>

<Dialog.Root
	{open}
	onOpenChange={(o) => {
		open = o;
		onOpenChange?.(o);
	}}
>
	<Dialog.Content class="max-w-lg max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>{isEditing ? 'Edit Channel' : 'Create Notification Channel'}</Dialog.Title>
			<Dialog.Description>
				{isEditing
					? 'Update the notification channel settings'
					: 'Create a reusable notification channel for alerts and events'}
			</Dialog.Description>
		</Dialog.Header>

		<form
			class="space-y-4"
			onsubmit={(e) => {
				e.preventDefault();
				handleSubmit();
			}}
		>
			<!-- Channel Name -->
			<div class="space-y-2">
				<Label for="channel-name">Name *</Label>
				<Input
					id="channel-name"
					type="text"
					placeholder="e.g., Ops Team Email"
					bind:value={name}
					disabled={submitting}
					required
				/>
			</div>

			<!-- Channel Type -->
			{#if !isEditing}
				<div class="space-y-2">
					<Label>Type *</Label>
					<div class="grid grid-cols-2 gap-2">
						<Button
							type="button"
							variant={channelType === 'email' ? 'default' : 'outline'}
							class="justify-start gap-2"
							onclick={() => (channelType = 'email')}
							disabled={submitting}
						>
							<Mail class="h-4 w-4" />
							Email
						</Button>
						<Button
							type="button"
							variant={channelType === 'webhook' ? 'default' : 'outline'}
							class="justify-start gap-2"
							onclick={() => (channelType = 'webhook')}
							disabled={submitting}
						>
							<Webhook class="h-4 w-4" />
							Webhook
						</Button>
					</div>
				</div>
			{/if}

			<!-- Email Config -->
			{#if channelType === 'email'}
				<div class="space-y-2">
					<Label for="email-recipients">Recipients *</Label>
					<Textarea
						id="email-recipients"
						placeholder="user@example.com, team@example.com"
						bind:value={emailRecipients}
						disabled={submitting}
						rows={3}
					/>
					<p class="text-xs text-muted-foreground">Comma-separated list of email addresses</p>
				</div>
			{/if}

			<!-- Webhook Config -->
			{#if channelType === 'webhook'}
				<div class="space-y-4">
					<div class="space-y-2">
						<div class="flex items-center gap-2">
							<Label for="webhook-url">URL *</Label>
							{#if isDiscordUrl}
								<span
									class="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
								>
									Discord format
								</span>
							{/if}
						</div>
						<Input
							id="webhook-url"
							type="url"
							placeholder="https://hooks.slack.com/..."
							bind:value={webhookUrl}
							disabled={submitting}
						/>
						{#if isDiscordUrl}
							<p class="text-xs text-muted-foreground">
								LogTide will send a Discord embed to this URL instead of the raw JSON envelope.
							</p>
						{/if}
					</div>

					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label for="webhook-method">Method</Label>
							<div class="flex gap-2">
								<Button
									type="button"
									variant={webhookMethod === 'POST' ? 'default' : 'outline'}
									size="sm"
									onclick={() => (webhookMethod = 'POST')}
									disabled={submitting}
								>
									POST
								</Button>
								<Button
									type="button"
									variant={webhookMethod === 'PUT' ? 'default' : 'outline'}
									size="sm"
									onclick={() => (webhookMethod = 'PUT')}
									disabled={submitting}
								>
									PUT
								</Button>
							</div>
						</div>

						<div class="space-y-2">
							<Label for="webhook-auth">Authentication</Label>
							<div class="flex gap-2">
								<Button
									type="button"
									variant={webhookAuthType === 'none' ? 'default' : 'outline'}
									size="sm"
									onclick={() => (webhookAuthType = 'none')}
									disabled={submitting}
								>
									None
								</Button>
								<Button
									type="button"
									variant={webhookAuthType === 'bearer' ? 'default' : 'outline'}
									size="sm"
									onclick={() => (webhookAuthType = 'bearer')}
									disabled={submitting}
								>
									Bearer
								</Button>
								<Button
									type="button"
									variant={webhookAuthType === 'basic' ? 'default' : 'outline'}
									size="sm"
									onclick={() => (webhookAuthType = 'basic')}
									disabled={submitting}
								>
									Basic
								</Button>
							</div>
						</div>
					</div>

					{#if webhookAuthType === 'bearer'}
						<div class="space-y-2">
							<Label for="webhook-token">Bearer Token</Label>
							<Input
								id="webhook-token"
								type="password"
								placeholder={hasStoredAuthSecret ? 'Leave blank to keep current token' : 'Enter token'}
								bind:value={webhookAuthToken}
								disabled={submitting}
							/>
						</div>
					{/if}

					{#if webhookAuthType === 'basic'}
						<div class="grid grid-cols-2 gap-4">
							<div class="space-y-2">
								<Label for="webhook-user">Username</Label>
								<Input
									id="webhook-user"
									type="text"
									placeholder="Username"
									bind:value={webhookAuthUser}
									disabled={submitting}
								/>
							</div>
							<div class="space-y-2">
								<Label for="webhook-pass">Password</Label>
								<Input
									id="webhook-pass"
									type="password"
									placeholder={hasStoredAuthSecret ? 'Leave blank to keep current password' : 'Password'}
									bind:value={webhookAuthPass}
									disabled={submitting}
								/>
							</div>
						</div>
					{/if}

					<div class="space-y-2">
						<Label for="webhook-headers">Custom Headers (JSON)</Label>
						<Textarea
							id="webhook-headers"
							placeholder={'{\n  "X-Custom-Header": "value"\n}'}
							bind:value={webhookHeaders}
							disabled={submitting}
							rows={3}
							class="font-mono text-sm"
						/>
					</div>
				</div>
			{/if}

			<!-- Description -->
			<div class="space-y-2">
				<Label for="channel-desc">Description (optional)</Label>
				<Input
					id="channel-desc"
					type="text"
					placeholder="Optional description"
					bind:value={description}
					disabled={submitting}
				/>
			</div>

			<!-- Test Result -->
			{#if testResult}
				<div
					class="flex items-center gap-2 p-3 rounded-md text-sm {testResult.success
						? 'bg-green-50 text-green-800'
						: 'bg-red-50 text-red-800'}"
				>
					{#if testResult.success}
						<Check class="h-4 w-4" />
						Test notification sent successfully
					{:else}
						<X class="h-4 w-4" />
						{testResult.error || 'Test failed'}
					{/if}
				</div>
			{/if}
		</form>

		<Dialog.Footer class="gap-2">
			{#if isEditing}
				<Button
					type="button"
					variant="outline"
					onclick={handleTest}
					disabled={submitting || testing}
					class="gap-2"
				>
					{#if testing}
						<Spinner size="sm" />
					{:else}
						<TestTube class="h-4 w-4" />
					{/if}
					Test
				</Button>
			{/if}
			<div class="flex-1"></div>
			<Button type="button" variant="outline" onclick={() => (open = false)} disabled={submitting}>
				Cancel
			</Button>
			<Button onclick={handleSubmit} disabled={submitting}>
				{#if submitting}
					<Spinner size="sm" className="mr-2" />
				{/if}
				{isEditing ? 'Save Changes' : 'Create Channel'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
