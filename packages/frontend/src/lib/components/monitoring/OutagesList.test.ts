import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import OutagesList from './OutagesList.svelte';

describe('OutagesList', () => {
  it('empty state says outages appear once the monitor goes down', () => {
    render(OutagesList, { props: { outages: [] } });
    expect(screen.getByText(/Outages appear here once the monitor goes down/)).toBeInTheDocument();
  });

  it('shows Ongoing and a link to /dashboard/incidents/<id> for an open outage', () => {
    render(OutagesList, {
      props: {
        outages: [
          {
            incidentId: 'inc-1',
            title: 'Monitor down: API',
            status: 'open',
            severity: 'high',
            startedAt: '2026-10-22T10:00:00Z',
            resolvedAt: null,
            durationSeconds: null,
          },
          {
            incidentId: 'inc-2',
            title: 'Monitor down: API',
            status: 'resolved',
            severity: 'high',
            startedAt: '2026-10-21T10:00:00Z',
            resolvedAt: '2026-10-21T10:04:12Z',
            durationSeconds: 252,
          },
        ],
      },
    });
    expect(screen.getByText('Ongoing')).toBeInTheDocument();
    expect(screen.getByText('4 min 12 s')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'Monitor down: API' });
    expect(links[0]).toHaveAttribute('href', '/dashboard/incidents/inc-1');
    expect(links[1]).toHaveAttribute('href', '/dashboard/incidents/inc-2');
  });
});
