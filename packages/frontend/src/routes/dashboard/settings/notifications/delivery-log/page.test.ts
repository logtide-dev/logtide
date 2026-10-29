import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const deliveriesApi = vi.hoisted(() => ({
	listWebhookDeliveries: vi.fn(),
	replayWebhookDelivery: vi.fn(),
	getWebhookDelivery: vi.fn(),
}));
vi.mock('$lib/api/webhook-deliveries', () => deliveriesApi);

const channelsApi = vi.hoisted(() => ({
	list: vi.fn(),
	getDefaults: vi.fn(),
	setDefaults: vi.fn(),
	getOverrides: vi.fn(),
}));
vi.mock('$lib/api/notification-channels', () => ({ notificationChannelsAPI: channelsApi }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('$lib/stores/toast', () => ({ toastStore: toast }));

import Page from './+page.svelte';
import { authStore } from '$lib/stores/auth';
import { organizationStore } from '$lib/stores/organization';
import { notificationChannelsStore } from '$lib/stores/notification-channels';

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

function delivery(id: string, status: string, extra: Record<string, unknown> = {}) {
	return {
		id,
		organizationId: 'org-1',
		eventType: 'monitor.status_changed',
		eventId: `evt-${id}`,
		url: 'https://hooks.slack.com/services/T0001/B0002/secretpart',
		status,
		attemptCount: 2,
		maxAttempts: 5,
		nextAttemptAt: null,
		lastError: null,
		metadata: { channelId: 'c1' },
		createdAt: '2026-08-10T10:00:00.000Z',
		updatedAt: '2026-08-10T10:00:00.000Z',
		...extra,
	};
}

describe('delivery log page', () => {
	beforeEach(() => {
		localStorage.clear();
		for (const fn of Object.values(deliveriesApi)) fn.mockReset();
		for (const fn of Object.values(channelsApi)) fn.mockReset();
		toast.success.mockReset();
		toast.error.mockReset();
		channelsApi.list.mockResolvedValue([
			{
				id: 'c1',
				organizationId: 'org-1',
				name: 'Ops Slack',
				type: 'webhook',
				enabled: true,
				description: null,
				config: { url: 'https://hooks.slack.com/services/T0001/B0002/x' },
				createdBy: null,
				createdAt: '2026-08-10T00:00:00.000Z',
				updatedAt: '2026-08-10T00:00:00.000Z',
			},
		]);
		deliveriesApi.listWebhookDeliveries.mockResolvedValue([]);
		notificationChannelsStore.reset();
		authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
		organizationStore.clear();
	});

	it('offers Retry only on dead rows for an admin', async () => {
		deliveriesApi.listWebhookDeliveries.mockResolvedValue([
			delivery('d1', 'failed'),
			delivery('d2', 'dead'),
		]);
		organizationStore.setCurrentOrganization({ ...baseOrg });
		render(Page);
		await screen.findByText('Dead letter');

		expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
	});

	it('hides Retry from members', async () => {
		deliveriesApi.listWebhookDeliveries.mockResolvedValue([delivery('d2', 'dead')]);
		organizationStore.setCurrentOrganization({ ...baseOrg, role: 'member' });
		render(Page);
		await screen.findByText('Dead letter');

		expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
	});

	it('shows the host only and the resolved destination name', async () => {
		deliveriesApi.listWebhookDeliveries.mockResolvedValue([delivery('d1', 'delivered')]);
		organizationStore.setCurrentOrganization({ ...baseOrg });
		const { container } = render(Page);
		await screen.findByText('hooks.slack.com');
		await screen.findByText('Ops Slack');

		expect(container.textContent).not.toContain('T0001');
		expect(container.textContent).not.toContain('secretpart');
	});

	it('labels statuses Delivered, Retrying, Dead letter and Pending', async () => {
		deliveriesApi.listWebhookDeliveries.mockResolvedValue([
			delivery('d1', 'delivered'),
			delivery('d2', 'failed'),
			delivery('d3', 'dead'),
			delivery('d4', 'pending'),
		]);
		organizationStore.setCurrentOrganization({ ...baseOrg });
		const { container } = render(Page);
		await screen.findByText('Dead letter');

		const cells = Array.from(container.querySelectorAll('tbody span.rounded-full')).map((e) =>
			e.textContent?.trim()
		);
		expect(cells).toEqual(['Delivered', 'Retrying', 'Dead letter', 'Pending']);
	});

	it('asks for offset 50 on the next page', async () => {
		const full = Array.from({ length: 51 }, (_, i) => delivery(`d${i}`, 'delivered'));
		deliveriesApi.listWebhookDeliveries.mockResolvedValue(full);
		organizationStore.setCurrentOrganization({ ...baseOrg });
		render(Page);
		const next = await screen.findByRole('button', { name: 'Next' });

		deliveriesApi.listWebhookDeliveries.mockClear();
		deliveriesApi.listWebhookDeliveries.mockResolvedValue([]);
		await fireEvent.click(next);

		await waitFor(() =>
			expect(deliveriesApi.listWebhookDeliveries).toHaveBeenCalledWith(
				expect.objectContaining({ offset: 50, limit: 51 })
			)
		);
	});

	it('shows the empty state', async () => {
		organizationStore.setCurrentOrganization({ ...baseOrg });
		render(Page);
		expect(await screen.findByText('No deliveries yet')).toBeInTheDocument();
	});

	it('shows the error state and reloads on Retry', async () => {
		deliveriesApi.listWebhookDeliveries.mockRejectedValueOnce(new Error('boom'));
		organizationStore.setCurrentOrganization({ ...baseOrg });
		render(Page);
		await screen.findByText('Could not load the delivery log');

		deliveriesApi.listWebhookDeliveries.mockResolvedValue([delivery('d1', 'delivered')]);
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

		await screen.findByText('hooks.slack.com');
		expect(deliveriesApi.listWebhookDeliveries).toHaveBeenCalledTimes(2);
	});
});
