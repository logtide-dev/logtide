import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('$lib/api/receivers', () => ({
	receiversAPI: { listEvents: vi.fn().mockResolvedValue({ events: [] }) },
}));

import CreateReceiverDialog from './CreateReceiverDialog.svelte';
import ReceiverEventsDialog from './ReceiverEventsDialog.svelte';

describe('inbound webhook copy', () => {
	it('names the create dialog Inbound webhook everywhere', () => {
		render(CreateReceiverDialog, { onSubmit: vi.fn(), open: true });

		expect(screen.getByRole('heading', { name: 'Create inbound webhook' })).toBeInTheDocument();
		expect(
			screen.getByText(/Inbound webhooks receive events from other tools/)
		).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Create inbound webhook' })).toBeInTheDocument();
		expect(screen.queryByText(/Receiver/)).toBeNull();
		expect(document.body.textContent).not.toMatch(/[–—]/);
	});

	it('names the events dialog Inbound webhook events', async () => {
		render(ReceiverEventsDialog, {
			projectId: 'p1',
			receiver: { id: 'r1', name: 'GitHub deploys' } as never,
			open: true,
		});

		expect(await screen.findByText(/^Inbound webhook events/)).toBeInTheDocument();
		expect(screen.queryByText(/Receiver/)).toBeNull();
		expect(document.body.textContent).not.toMatch(/[–—]/);
	});
});
