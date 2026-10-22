import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const api = vi.hoisted(() => ({
	list: vi.fn(),
	getDefaults: vi.fn(),
	setDefaults: vi.fn(),
	getOverrides: vi.fn(),
}));

vi.mock('$lib/api/notification-channels', () => ({
	notificationChannelsAPI: api,
}));

const preview = vi.hoisted(() => vi.fn());
vi.mock('$lib/api/notification-routing', () => ({
	notificationRoutingAPI: { preview },
}));

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

const opsEmail = {
	id: 'c1',
	organizationId: 'org-1',
	name: 'Ops email',
	type: 'email',
	enabled: true,
	description: null,
	config: { recipients: ['ops@x.com'] },
	createdBy: null,
	createdAt: '2026-08-10T00:00:00.000Z',
	updatedAt: '2026-08-10T00:00:00.000Z',
};

const emptyDefaults = { alert: [], sigma: [], incident: [], error: [], monitoring: [] };

const LABELS = ['Alerts', 'Security detections', 'Security incidents', 'Uptime', 'Errors'];

function cardOf(label: string): HTMLElement {
	const title = screen
		.getAllByRole('heading', { level: 3 })
		.find((h) => h.textContent?.trim() === label);
	if (!title) throw new Error(`no card titled ${label}`);
	return title.closest('.rounded-lg') as HTMLElement;
}

describe('routing page', () => {
	beforeEach(() => {
		localStorage.clear();
		for (const fn of Object.values(api)) fn.mockReset();
		preview.mockReset();
		toast.success.mockReset();
		toast.error.mockReset();
		api.list.mockResolvedValue([opsEmail]);
		api.getDefaults.mockResolvedValue({ ...emptyDefaults });
		api.setDefaults.mockResolvedValue(undefined);
		api.getOverrides.mockResolvedValue([]);
		preview.mockResolvedValue({ destinations: [], fallback: 'owners_admins_email' });
		notificationChannelsStore.reset();
		authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
		organizationStore.clear();
	});

	it('renders the five event cards in order with the fallback line', async () => {
		organizationStore.setCurrentOrganization({ ...baseOrg });
		render(Page);
		await screen.findByText('Uptime');

		const cards = LABELS.map(cardOf);
		for (let i = 1; i < cards.length; i++) {
			expect(
				cards[i - 1].compareDocumentPosition(cards[i]) & Node.DOCUMENT_POSITION_FOLLOWING
			).toBeTruthy();
		}
		for (const card of cards) {
			expect(
				within(card).getByText('If none: email organization owners and admins.')
			).toBeInTheDocument();
		}
		expect(screen.getByText('A monitor goes down or recovers.')).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Routing' })).toBeInTheDocument();
	});

	it('saves the Uptime default through setDefaults and toasts', async () => {
		organizationStore.setCurrentOrganization({ ...baseOrg });
		render(Page);
		await screen.findByText('Uptime');

		const card = cardOf('Uptime');
		await fireEvent.click(await within(card).findByRole('button', { name: /No default destinations/ }));
		await fireEvent.click(await screen.findByRole('button', { name: /Ops email/ }));

		await waitFor(() => expect(api.setDefaults).toHaveBeenCalledWith('org-1', 'monitoring', ['c1']));
		await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Routing updated'));
	});

	it('renders a sigma override row linking to the rule', async () => {
		api.getOverrides.mockResolvedValue([
			{
				eventType: 'sigma',
				kind: 'sigma_rule',
				id: 'rule-9',
				name: 'Suspicious login',
				channels: [{ id: 'c1', name: 'Ops email', type: 'email' }],
			},
		]);
		organizationStore.setCurrentOrganization({ ...baseOrg });
		render(Page);

		const link = await screen.findByRole('link', { name: 'Suspicious login' });
		expect(link.getAttribute('href')).toBe('/dashboard/security/rules/rule-9');
		expect(screen.getByText('Rules with their own destinations')).toBeInTheDocument();
	});

	it('links a monitor override to that monitor', async () => {
		api.getOverrides.mockResolvedValue([
			{
				eventType: 'monitoring',
				kind: 'monitor',
				id: 'mon-3',
				name: 'API health',
				channels: [{ id: 'c1', name: 'Ops email', type: 'email' }],
			},
		]);
		organizationStore.setCurrentOrganization({ ...baseOrg });
		render(Page);

		const link = await screen.findByRole('link', { name: 'API health' });
		expect(link.getAttribute('href')).toBe('/dashboard/uptime/mon-3');
	});

	it('shows the empty state when no rule overrides the defaults', async () => {
		organizationStore.setCurrentOrganization({ ...baseOrg });
		render(Page);
		expect(await screen.findByText('No rules override the defaults')).toBeInTheDocument();
	});

	it('is read-only for a member', async () => {
		organizationStore.setCurrentOrganization({ ...baseOrg, role: 'member' });
		render(Page);
		await screen.findByText('Uptime');

		const card = cardOf('Uptime');
		const selector = await within(card).findByRole('button', { name: /No default destinations/ });
		expect((selector as HTMLButtonElement).disabled).toBe(true);
		expect(api.setDefaults).not.toHaveBeenCalled();
	});
});
