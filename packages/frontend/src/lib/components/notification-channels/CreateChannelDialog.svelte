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
	import { stateTone } from '$lib/utils/severity';
	import type {
		NotificationChannel,
		ChannelConfig,
		EmailChannelConfig,
		WebhookChannelConfig,
		PagerDutyChannelConfig,
	} from '$lib/api/notification-channels';
	import { detectWebhookFlavor } from '@logtide/shared';
	import DestinationTypePicker from './DestinationTypePicker.svelte';
	import DestinationTypeIcon from './DestinationTypeIcon.svelte';
	import {
		getDestinationType,
		displayTypeOf,
		type DestinationTypeId,
	} from './destination-types';
	import TestTube from '@lucide/svelte/icons/test-tube';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';

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
	// Shows validation messages once the user tried to submit.
	let attempted = $state(false);

	// Step 1 is the type picker (create mode only); null means "not picked yet".
	let destType = $state<DestinationTypeId | null>(null);

	// Form state
	let name = $state('');
	let description = $state('');

	// Email config
	let emailRecipients = $state('');

	// Webhook config (generic, Slack, Teams, Discord)
	let webhookUrl = $state('');
	let webhookMethod = $state<'POST' | 'PUT'>('POST');
	let webhookHeaders = $state('');
	let webhookAuthType = $state<'none' | 'bearer' | 'basic'>('none');
	let webhookAuthToken = $state('');
	let webhookAuthUser = $state('');
	let webhookAuthPass = $state('');
	// Whether the destination being edited already has a stored secret. Secrets
	// are never sent back to the client, so on edit we keep the secret fields
	// empty and only submit a new value when the user types one.
	let hasStoredAuthSecret = $state(false);
	let storedAuthType = $state<'none' | 'bearer' | 'basic'>('none');

	// PagerDuty config
	let routingKey = $state('');

	const isEditing = $derived(!!channel);
	const typeInfo = $derived(destType ? getDestinationType(destType) : null);
	const isVendorWebhook = $derived(
		destType === 'slack' || destType === 'teams' || destType === 'discord'
	);
	const isWebhookForm = $derived(destType === 'webhook' || isVendorWebhook);

	// Slack, Teams and Discord reject the raw event envelope, so the backend
	// sends their native format to these URLs. Surfacing it keeps the payload
	// change discoverable.
	const flavor = $derived(isWebhookForm ? detectWebhookFlavor(webhookUrl.trim()) : 'generic');
	const FLAVOR_BADGES: Record<string, { badge: string; hint: string }> = {
		slack: {
			badge: 'Slack format',
			hint: 'LogTide will send a Slack message to this URL instead of the raw JSON envelope.',
		},
		teams: {
			badge: 'Teams format',
			hint: 'LogTide will send a Microsoft Teams card to this URL instead of the raw JSON envelope.',
		},
		discord: {
			badge: 'Discord format',
			hint: 'LogTide will send a Discord embed to this URL instead of the raw JSON envelope.',
		},
	};
	const flavorBadge = $derived(FLAVOR_BADGES[flavor] ?? null);

	const headersError = $derived.by(() => {
		if (destType !== 'webhook' || !webhookHeaders.trim()) return null;
		try {
			const parsed = JSON.parse(webhookHeaders);
			if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
				return 'Custom headers must be a JSON object';
			}
			return null;
		} catch {
			return 'Custom headers must be valid JSON';
		}
	});

	const urlError = $derived.by(() => {
		if (!isWebhookForm) return null;
		const url = webhookUrl.trim();
		if (!url) return 'Webhook URL is required';
		try {
			const parsed = new URL(url);
			if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Invalid webhook URL';
		} catch {
			return 'Invalid webhook URL';
		}
		return typeInfo?.validateUrl?.(url) ?? null;
	});

	const validationError = $derived.by((): string | null => {
		if (!destType) return 'Choose a destination type';
		if (!name.trim()) return 'Name is required';

		if (destType === 'email') {
			const recipients = parseRecipients();
			if (recipients.length === 0) return 'At least one email recipient is required';
			const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
			const invalid = recipients.filter((e) => !emailRegex.test(e));
			if (invalid.length > 0) return `Invalid email: ${invalid[0]}`;
			return null;
		}

		if (destType === 'pagerduty') {
			const key = routingKey.trim();
			if (!key) return isEditing ? null : 'Routing key is required';
			if (!/^[A-Za-z0-9]{20,40}$/.test(key)) {
				return 'Routing key must be 20 to 40 letters and digits';
			}
			return null;
		}

		if (urlError) return urlError;
		return headersError;
	});

	// Inline message shown under the url field.
	const showUrlError = $derived(isWebhookForm && !!urlError && (attempted || webhookUrl.trim() !== ''));

	function parseRecipients(): string[] {
		return emailRecipients
			.split(',')
			.map((e) => e.trim())
			.filter((e) => e);
	}

	function resetForm() {
		destType = null;
		name = '';
		description = '';
		emailRecipients = '';
		webhookUrl = '';
		webhookMethod = 'POST';
		webhookHeaders = '';
		webhookAuthType = 'none';
		webhookAuthToken = '';
		webhookAuthUser = '';
		webhookAuthPass = '';
		hasStoredAuthSecret = false;
		storedAuthType = 'none';
		routingKey = '';
		testResult = null;
		attempted = false;
	}

	function populateForm(ch: NotificationChannel) {
		name = ch.name;
		description = ch.description || '';
		testResult = null;
		attempted = false;

		let display = displayTypeOf(ch);

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
				storedAuthType = 'bearer';
				webhookAuthToken = '';
				hasStoredAuthSecret = true;
			} else if (config.auth?.type === 'basic') {
				webhookAuthType = 'basic';
				storedAuthType = 'basic';
				webhookAuthUser = config.auth.username;
				webhookAuthPass = '';
				hasStoredAuthSecret = true;
			} else {
				webhookAuthType = 'none';
				storedAuthType = 'none';
				hasStoredAuthSecret = false;
			}
			// A vendor form has no auth or header fields: keep the generic form for
			// destinations that carry them so saving does not drop anything.
			if (display !== 'webhook' && (config.auth || (config.headers && Object.keys(config.headers).length > 0))) {
				display = 'webhook';
			}
		} else if (ch.type === 'pagerduty') {
			// The routing key is write-only; leave the field empty.
			routingKey = '';
		}

		destType = display;
	}

	$effect(() => {
		if (open && channel) {
			populateForm(channel);
		} else if (!open) {
			resetForm();
		}
	});

	function buildConfig(): ChannelConfig {
		if (destType === 'email') {
			return { recipients: parseRecipients() } satisfies EmailChannelConfig;
		}

		if (destType === 'pagerduty') {
			// A blank key in edit mode is omitted so the backend keeps the stored one.
			const key = routingKey.trim();
			return (key ? { routingKey: key } : {}) as PagerDutyChannelConfig;
		}

		const config: WebhookChannelConfig = {
			url: webhookUrl.trim(),
			method: isVendorWebhook ? 'POST' : webhookMethod,
		};

		if (destType !== 'webhook') return config;

		if (webhookHeaders.trim()) {
			try {
				config.headers = JSON.parse(webhookHeaders);
			} catch {
				// validation reports invalid JSON before we get here
			}
		}

		const keepsStoredSecret = isEditing && hasStoredAuthSecret && storedAuthType === webhookAuthType;

		if (webhookAuthType === 'bearer') {
			if (webhookAuthToken) {
				config.auth = { type: 'bearer', token: webhookAuthToken };
			} else if (keepsStoredSecret) {
				// Same auth type, no new token: the backend keeps the stored one.
				config.auth = { type: 'bearer' } as WebhookChannelConfig['auth'];
			}
		} else if (webhookAuthType === 'basic' && webhookAuthUser) {
			const basicAuth: { type: 'basic'; username: string; password?: string } = {
				type: 'basic',
				username: webhookAuthUser,
			};
			if (webhookAuthPass) {
				basicAuth.password = webhookAuthPass;
			}
			config.auth = basicAuth as WebhookChannelConfig['auth'];
		}

		return config;
	}

	async function handleTest() {
		if (!currentOrg || !typeInfo) return;

		if (validationError) {
			attempted = true;
			toastStore.error(validationError);
			return;
		}

		testing = true;
		testResult = null;

		try {
			const result = await notificationChannelsStore.testUnsaved({
				organizationId: currentOrg.id,
				...(isEditing && channel ? { channelId: channel.id } : {}),
				type: typeInfo.storedType,
				config: buildConfig(),
			});
			testResult = result;
			if (result.success) {
				toastStore.success('Test notification sent');
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
		if (!currentOrg || !typeInfo) {
			toastStore.error('No organization selected');
			return;
		}

		if (validationError) {
			attempted = true;
			toastStore.error(validationError);
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
				toastStore.success('Destination updated');
			} else {
				result = await notificationChannelsStore.create(currentOrg.id, {
					name: name.trim(),
					type: typeInfo.storedType,
					config,
					description: description.trim() || undefined,
				});
				toastStore.success('Destination created');
			}

			resetForm();
			open = false;
			onSuccess?.(result);
		} catch (err) {
			toastStore.error(err instanceof Error ? err.message : 'Failed to save destination');
		} finally {
			submitting = false;
		}
	}

	const title = $derived(
		isEditing
			? 'Edit destination'
			: typeInfo
				? `Add ${typeInfo.label} destination`
				: 'Add destination'
	);
	const dialogDescription = $derived(
		isEditing
			? 'Update the destination settings.'
			: typeInfo
				? typeInfo.description
				: 'Choose where LogTide should send notifications.'
	);
	const okTone = stateTone('ok');
	const failedTone = stateTone('failed');
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
			<Dialog.Title class="flex items-center gap-2">
				{#if destType}
					<DestinationTypeIcon type={destType} />
				{/if}
				{title}
			</Dialog.Title>
			<Dialog.Description>{dialogDescription}</Dialog.Description>
		</Dialog.Header>

		{#if !destType}
			<DestinationTypePicker onSelect={(id) => (destType = id)} />

			<Dialog.Footer class="gap-2">
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
			</Dialog.Footer>
		{:else}
			<form
				class="space-y-4"
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
			>
				<div class="space-y-2">
					<Label for="channel-name">Name *</Label>
					<Input
						id="channel-name"
						type="text"
						placeholder="Ops team"
						bind:value={name}
						disabled={submitting}
						required
					/>
				</div>

				{#if destType === 'email'}
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

				{#if isWebhookForm}
					<div class="space-y-4">
						<div class="space-y-2">
							<div class="flex items-center gap-2">
								<Label for="webhook-url">{isVendorWebhook ? 'Webhook URL *' : 'URL *'}</Label>
								{#if flavorBadge}
									<span
										class="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
									>
										{flavorBadge.badge}
									</span>
								{/if}
							</div>
							<Input
								id="webhook-url"
								type="url"
								placeholder={typeInfo?.urlPlaceholder ?? 'https://example.com/hooks/logtide'}
								bind:value={webhookUrl}
								disabled={submitting}
								aria-invalid={showUrlError}
							/>
							{#if showUrlError}
								<p class="text-xs {stateTone('failed').text}">{urlError}</p>
							{:else if flavorBadge}
								<p class="text-xs text-muted-foreground">{flavorBadge.hint}</p>
							{/if}
						</div>

						{#if destType === 'webhook'}
							<div class="grid grid-cols-2 gap-4">
								<div class="space-y-2">
									<Label>Method</Label>
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
									<Label>Authentication</Label>
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
									<Label for="webhook-token">Bearer token</Label>
									<Input
										id="webhook-token"
										type="password"
										placeholder={hasStoredAuthSecret && storedAuthType === 'bearer'
											? 'Leave blank to keep current token'
											: 'Enter token'}
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
											placeholder={hasStoredAuthSecret && storedAuthType === 'basic'
												? 'Leave blank to keep current password'
												: 'Password'}
											bind:value={webhookAuthPass}
											disabled={submitting}
										/>
									</div>
								</div>
							{/if}

							<div class="space-y-2">
								<Label for="webhook-headers">Custom headers (JSON)</Label>
								<Textarea
									id="webhook-headers"
									placeholder={'{\n  "X-Custom-Header": "value"\n}'}
									bind:value={webhookHeaders}
									disabled={submitting}
									rows={3}
									class="font-mono text-sm"
									aria-invalid={!!headersError}
								/>
								{#if headersError}
									<p class="text-xs {stateTone('failed').text}">{headersError}</p>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				{#if destType === 'pagerduty'}
					<div class="space-y-2">
						<Label for="pagerduty-key">{isEditing ? 'Routing key' : 'Routing key *'}</Label>
						<Input
							id="pagerduty-key"
							type="password"
							autocomplete="off"
							placeholder={isEditing ? 'Leave blank to keep current key' : 'Enter routing key'}
							bind:value={routingKey}
							disabled={submitting}
						/>
						<p class="text-xs text-muted-foreground">
							Integration key of an Events API v2 integration
						</p>
						<p class="text-xs text-muted-foreground">
							Testing creates and immediately resolves a low urgency incident.
						</p>
					</div>
				{/if}

				<div class="space-y-2">
					<Label for="channel-desc">Description (optional)</Label>
					<Input
						id="channel-desc"
						type="text"
						placeholder="What this destination is for"
						bind:value={description}
						disabled={submitting}
					/>
				</div>

				{#if testResult}
					<div
						role="status"
						class="flex items-center gap-2 rounded-md border p-3 text-sm {testResult.success
							? okTone.badge
							: failedTone.badge}"
					>
						{#if testResult.success}
							<Check class="h-4 w-4" aria-hidden="true" />
							Test notification sent
						{:else}
							<X class="h-4 w-4" aria-hidden="true" />
							{testResult.error || 'Test failed'}
						{/if}
					</div>
				{/if}
			</form>

			<Dialog.Footer class="gap-2">
				{#if !isEditing}
					<Button
						type="button"
						variant="ghost"
						onclick={() => {
							destType = null;
							testResult = null;
							attempted = false;
						}}
						disabled={submitting}
						class="gap-2"
					>
						<ArrowLeft class="h-4 w-4" aria-hidden="true" />
						Back
					</Button>
				{/if}
				<Button
					type="button"
					variant="outline"
					onclick={handleTest}
					disabled={submitting || testing || !!validationError}
					class="gap-2"
				>
					{#if testing}
						<Spinner size="sm" />
					{:else}
						<TestTube class="h-4 w-4" aria-hidden="true" />
					{/if}
					Test
				</Button>
				<div class="flex-1"></div>
				<Button type="button" variant="outline" onclick={() => (open = false)} disabled={submitting}>
					Cancel
				</Button>
				<Button onclick={handleSubmit} disabled={submitting}>
					{#if submitting}
						<Spinner size="sm" className="mr-2" />
					{/if}
					{isEditing ? 'Save changes' : 'Create destination'}
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
