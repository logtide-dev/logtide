import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const store = vi.hoisted(() => ({
	create: vi.fn(),
	update: vi.fn(),
	testUnsaved: vi.fn(),
	test: vi.fn(),
}));

vi.mock('$lib/stores/notification-channels', () => ({
	notificationChannelsStore: store,
}));

import CreateChannelDialog from './CreateChannelDialog.svelte';
import { organizationStore } from '$lib/stores/organization';
import type { NotificationChannel } from '$lib/api/notification-channels';

const SLACK = 'https://hooks.slack.com/services/T0001/B0002/abcDEF';
const KEY = 'k'.repeat(32);

const baseOrg = {
	id: 'org-1',
	name: 'Acme',
	slug: 'acme',
	ownerId: 'user-1',
	role: 'owner' as const,
	retentionDays: 90,
	createdAt: new Date('2026-01-01T00:00:00.000Z'),
	updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function channel(type: 'webhook' | 'pagerduty', config: unknown): NotificationChannel {
	return {
		id: 'ch-1',
		organizationId: 'org-1',
		name: 'Existing',
		type,
		enabled: true,
		description: null,
		config,
		createdBy: null,
		createdAt: new Date('2026-08-10T00:00:00.000Z'),
		updatedAt: new Date('2026-08-10T00:00:00.000Z'),
	} as unknown as NotificationChannel;
}

async function type(label: string, value: string) {
	const el = await screen.findByLabelText(label);
	await fireEvent.input(el, { target: { value } });
}

async function pick(label: RegExp) {
	await fireEvent.click(await screen.findByRole('button', { name: label }));
}

beforeEach(() => {
	localStorage.clear();
	for (const fn of Object.values(store)) fn.mockReset();
	store.create.mockImplementation(async (_org: string, input: unknown) => ({
		id: 'new',
		...(input as object),
	}));
	store.update.mockResolvedValue({ id: 'ch-1' });
	store.testUnsaved.mockResolvedValue({ success: true });
	organizationStore.setCurrentOrganization({ ...baseOrg });
});

describe('CreateChannelDialog type picker', () => {
	it('starts on the picker with the six destination types', async () => {
		render(CreateChannelDialog, { props: { open: true } });
		for (const name of ['Email', 'Webhook', 'Slack', 'Microsoft Teams', 'Discord', 'PagerDuty']) {
			expect(await screen.findByRole('button', { name: new RegExp(`^${name}`) })).toBeTruthy();
		}
	});

	it('shows the Slack url field and blocks a url that is not a Slack webhook', async () => {
		render(CreateChannelDialog, { props: { open: true } });
		await pick(/^Slack/);
		await type('Name *', 'Ops Slack');
		await type('Webhook URL *', 'https://example.com');
		await fireEvent.click(screen.getByRole('button', { name: 'Create destination' }));

		expect(screen.getAllByText('This does not look like a Slack webhook URL').length).toBeGreaterThan(0);
		expect(store.create).not.toHaveBeenCalled();
	});

	it('creates a slack destination as a stored webhook', async () => {
		render(CreateChannelDialog, { props: { open: true } });
		await pick(/^Slack/);
		await type('Name *', 'Ops Slack');
		await type('Webhook URL *', SLACK);
		await fireEvent.click(screen.getByRole('button', { name: 'Create destination' }));

		await waitFor(() => expect(store.create).toHaveBeenCalledTimes(1));
		const [orgId, input] = store.create.mock.calls[0];
		expect(orgId).toBe('org-1');
		expect(input.type).toBe('webhook');
		expect(input.name).toBe('Ops Slack');
		expect(input.config.url).toBe(SLACK);
	});

	it('creates a pagerduty destination with its routing key', async () => {
		render(CreateChannelDialog, { props: { open: true } });
		await pick(/^PagerDuty/);
		await type('Name *', 'On call');
		await type('Routing key *', KEY);
		await fireEvent.click(screen.getByRole('button', { name: 'Create destination' }));

		await waitFor(() => expect(store.create).toHaveBeenCalledTimes(1));
		const [, input] = store.create.mock.calls[0];
		expect(input.type).toBe('pagerduty');
		expect(input.config).toEqual({ routingKey: KEY });
	});

	it('tests an unsaved destination without creating it', async () => {
		render(CreateChannelDialog, { props: { open: true } });
		await pick(/^Slack/);
		const testButton = screen.getByRole('button', { name: 'Test' }) as HTMLButtonElement;
		expect(testButton.disabled).toBe(true);

		await type('Name *', 'Ops Slack');
		await type('Webhook URL *', SLACK);
		expect(testButton.disabled).toBe(false);
		await fireEvent.click(testButton);

		await waitFor(() => expect(store.testUnsaved).toHaveBeenCalledTimes(1));
		const input = store.testUnsaved.mock.calls[0][0];
		expect(input.organizationId).toBe('org-1');
		expect(input.type).toBe('webhook');
		expect(input.channelId).toBeUndefined();
		expect(input.config.url).toBe(SLACK);
		expect(store.create).not.toHaveBeenCalled();
		expect(await screen.findByText('Test notification sent')).toBeTruthy();
	});

	it('warns that a pagerduty test opens and resolves an incident', async () => {
		render(CreateChannelDialog, { props: { open: true } });
		await pick(/^PagerDuty/);
		expect(
			await screen.findByText('Testing creates and immediately resolves a low urgency incident.')
		).toBeTruthy();
	});
});

describe('CreateChannelDialog edit mode', () => {
	it('keeps a blank pagerduty routing key out of the payload and passes channelId to the test', async () => {
		render(CreateChannelDialog, {
			props: { open: true, channel: channel('pagerduty', { routingKey: '********' }) },
		});
		const key = (await screen.findByLabelText('Routing key')) as HTMLInputElement;
		expect(key.value).toBe('');
		expect(key.placeholder).toBe('Leave blank to keep current key');

		await fireEvent.click(screen.getByRole('button', { name: 'Test' }));
		await waitFor(() => expect(store.testUnsaved).toHaveBeenCalledTimes(1));
		const input = store.testUnsaved.mock.calls[0][0];
		expect(input.channelId).toBe('ch-1');
		expect(input.config).toEqual({});

		await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
		await waitFor(() => expect(store.update).toHaveBeenCalledTimes(1));
		expect(store.update.mock.calls[0][2].config).toEqual({});
	});

	it('sends the auth type without a token when the stored secret is kept', async () => {
		render(CreateChannelDialog, {
			props: {
				open: true,
				channel: channel('webhook', {
					url: 'https://example.com/hook',
					method: 'POST',
					auth: { type: 'bearer', hasSecret: true },
				}),
			},
		});
		await screen.findByLabelText('URL *');
		await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
		await waitFor(() => expect(store.update).toHaveBeenCalledTimes(1));
		expect(store.update.mock.calls[0][2].config.auth).toEqual({ type: 'bearer' });
	});

	it('opens a slack destination with headers as a generic webhook so nothing is dropped', async () => {
		render(CreateChannelDialog, {
			props: {
				open: true,
				channel: channel('webhook', { url: SLACK, headers: { 'X-Team': 'ops' } }),
			},
		});
		expect(await screen.findByLabelText('Custom headers (JSON)')).toBeTruthy();
	});
});

describe('CreateChannelDialog webhook flavor badge', () => {
	it('shows the discord badge for a discord webhook url', async () => {
		render(CreateChannelDialog, {
			props: {
				open: true,
				channel: channel('webhook', {
					url: 'https://discord.com/api/webhooks/153199955952022743/token',
					headers: { 'X-A': 'b' },
				}),
			},
		});
		expect(await screen.findByText('Discord format')).toBeTruthy();
	});

	it('shows Slack format for a slack url pasted into the generic webhook form', async () => {
		render(CreateChannelDialog, { props: { open: true } });
		await pick(/^Webhook/);
		await type('URL *', SLACK);
		expect(await screen.findByText('Slack format')).toBeTruthy();
	});

	it('does not show a badge for another host', async () => {
		render(CreateChannelDialog, {
			props: { open: true, channel: channel('webhook', { url: 'https://hooks.example.com/webhook' }) },
		});
		await screen.findByLabelText('URL *');
		expect(screen.queryByText(/format$/)).toBeNull();
	});
});
