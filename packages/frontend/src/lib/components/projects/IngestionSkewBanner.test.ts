import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import IngestionSkewBanner from './IngestionSkewBanner.svelte';

describe('IngestionSkewBanner', () => {
  it('renders nothing when there is no skew', () => {
    const { container } = render(IngestionSkewBanner, { props: { skew: null } });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('renders nothing when the count is zero', () => {
    const { container } = render(IngestionSkewBanner, {
      props: { skew: { count24h: 0, maxPastMs: 0, maxFutureMs: 0, lastSeenAt: '2026-07-17T09:00:00.000Z' } },
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('reports past skew with a localized count and an hour figure', () => {
    render(IngestionSkewBanner, {
      props: {
        skew: { count24h: 1234, maxPastMs: 97200000, maxFutureMs: 0, lastSeenAt: '2026-07-17T09:00:00.000Z' },
      },
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/1,234/)).toBeInTheDocument();
    expect(screen.getByText(/27 hours in the past/)).toBeInTheDocument();
  });

  it('reports future skew', () => {
    render(IngestionSkewBanner, {
      props: {
        skew: { count24h: 5, maxPastMs: 0, maxFutureMs: 3600000, lastSeenAt: '2026-07-17T09:00:00.000Z' },
      },
    });

    expect(screen.getByText(/1 hour ahead of the server clock/)).toBeInTheDocument();
  });
});
