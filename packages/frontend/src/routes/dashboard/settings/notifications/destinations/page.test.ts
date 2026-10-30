import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const api = vi.hoisted(() => ({
	list: vi.fn(),
	delete: vi.fn(),
	update: vi.fn(),
	create: vi.fn(),
	test: vi.fn(),
	testUnsaved: vi.fn(),
}));

vi.mock('$lib/api/notification-channels', () => ({
	notificationChannelsAPI: api,
}));

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

const channels = [
	{
		id: 'c1',
		organizationId: 'org-1',
		name: 'Ops email',
		type: 'email',
		enabled: true,
		description: null,
		config: { recipients: ['a@x.com', 'b@x.com'] },
		createdBy: null,
		createdAt: '2026-08-10T00:00:00.000Z',
		updatedAt: '2026-08-10T00:00:00.000Z',
	},
	{
		id: 'c2',
		organizationId: 'org-1',
		name: 'Team Slack',
		type: 'webhook',
		enabled: true,
		description: null,
		config: { url: 'https://hooks.slack.com/services/T0001/B0002/abc' },
		createdBy: null,
		createdAt: '2026-08-10T00:00:00.000Z',
		updatedAt: '2026-08-10T00:00:00.000Z',
	},
	{
		id: 'c3',
		organizationId: 'org-1',
		name: 'On call',
		type: 'pagerduty',
		enabled: false,
		description: null,
		config: { routingKey: '********' },
		createdBy: null,
		createdAt: '2026-08-10T00:00:00.000Z',
		updatedAt: '2026-08-10T00:00:00.000Z',
	},
];

describe('destinations page', () => {
	beforeEach(() => {
		localStorage.clear();
		for (const fn of Object.values(api)) fn.mockReset();
		api.list.mockResolvedValue(channels);
		api.delete.mockResolvedValue(undefined);
		notificationChannelsStore.reset();
		authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
		organizationStore.clear();
	});

	it('shows the table and the add button to an admin', async () => {
		organizationStore.setCurrentOrganization({ ...baseOrg, role: 'admin' });
		render(Page);

		expect(await screen.findByText('Ops email')).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Destinations' })).toBeInTheDocument();
		expect(screen.getByText('2 recipients')).toBeInTheDocument();
		expect(screen.getByText('hooks.slack.com')).toBeInTheDocument();
		expect(screen.getByText('Routing key set')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Add destination' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Actions for Ops email' })).toBeInTheDocument();
	});

	it('shows a read-only list to a member', async () => {
		organizationStore.setCurrentOrganization({ ...baseOrg, role: 'member' });
		render(Page);

		expect(await screen.findByText('Ops email')).toBeInTheDocument();
		expect(
			screen.getByText('Only organization admins and owners can change destinations.')
		).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Add destination' })).toBeNull();
		expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
	});

	it('renders the empty state with an add action', async () => {
		api.list.mockResolvedValue([]);
		organizationStore.setCurrentOrganization({ ...baseOrg });
		render(Page);

		expect(await screen.findByText('No destinations yet')).toBeInTheDocument();
		expect(screen.getAllByRole('button', { name: 'Add destination' }).length).toBeGreaterThan(0);
	});

	it('deletes only after the confirm dialog is confirmed', async () => {
		organizationStore.setCurrentOrganization({ ...baseOrg });
		render(Page);
		await screen.findByText('Ops email');

		await fireEvent.pointerDown(screen.getByRole('button', { name: 'Actions for Ops email' }), {
			button: 0,
			ctrlKey: false,
		});
		await fireEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }));

		const dialog = await screen.findByRole('alertdialog');
		expect(within(dialog).getByText('Delete destination?')).toBeInTheDocument();
		expect(api.delete).not.toHaveBeenCalled();

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete destination' }));
		await waitFor(() => expect(api.delete).toHaveBeenCalledWith('c1', 'org-1'));
	});

	it('never uses the native confirm dialog', () => {
		const files = [
			resolve(__dirname, '+page.svelte'),
			resolve(__dirname, '../../../../../lib/components/notification-channels/ChannelsList.svelte'),
			resolve(__dirname, '../../../../../lib/components/notification-channels/CreateChannelDialog.svelte'),
		];
		for (const file of files) {
			expect(readFileSync(file, 'utf8')).not.toMatch(/\bconfirm\(/);
		}
	});
});
