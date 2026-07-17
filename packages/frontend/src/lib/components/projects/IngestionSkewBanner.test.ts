import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import IngestionSkewBanner from './IngestionSkewBanner.svelte';

describe('IngestionSkewBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T09:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when there is no skew', () => {
    const { container } = render(IngestionSkewBanner, { props: { skew: null, signal: 'logs' } });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('renders nothing when the count is zero', () => {
    const { container } = render(IngestionSkewBanner, {
      props: {
        skew: { count24h: 0, maxPastMs: 0, maxFutureMs: 0, lastSeenAt: '2026-07-17T09:00:00.000Z' },
        signal: 'logs',
      },
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('reports past skew with a localized count and an hour figure', () => {
    render(IngestionSkewBanner, {
      props: {
        skew: { count24h: 1234, maxPastMs: 97200000, maxFutureMs: 0, lastSeenAt: '2026-07-17T09:00:00.000Z' },
        signal: 'logs',
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
        signal: 'logs',
      },
    });

    expect(screen.getByText(/1 hour ahead of the server clock/)).toBeInTheDocument();
  });

  it('renders the most recent skew time as a relative phrase (plural minutes)', () => {
    render(IngestionSkewBanner, {
      props: {
        // 5 minutes before the fixed system time.
        skew: { count24h: 5, maxPastMs: 3600000, maxFutureMs: 0, lastSeenAt: '2026-07-17T08:55:00.000Z' },
        signal: 'logs',
      },
    });

    expect(screen.getByText(/Most recent at 5 minutes ago\./)).toBeInTheDocument();
  });

  it('renders the most recent skew time with singular minute', () => {
    render(IngestionSkewBanner, {
      props: {
        // 1 minute before the fixed system time.
        skew: { count24h: 5, maxPastMs: 3600000, maxFutureMs: 0, lastSeenAt: '2026-07-17T08:59:00.000Z' },
        signal: 'logs',
      },
    });

    expect(screen.getByText(/Most recent at 1 minute ago\./)).toBeInTheDocument();
  });

  it('renders the most recent skew time in hours', () => {
    render(IngestionSkewBanner, {
      props: {
        // 2 hours before the fixed system time.
        skew: { count24h: 5, maxPastMs: 3600000, maxFutureMs: 0, lastSeenAt: '2026-07-17T07:00:00.000Z' },
        signal: 'logs',
      },
    });

    expect(screen.getByText(/Most recent at 2 hours ago\./)).toBeInTheDocument();
  });

  describe('per-signal copy', () => {
    const skew = {
      count24h: 3,
      maxPastMs: 97200000,
      maxFutureMs: 0,
      lastSeenAt: '2026-07-17T09:00:00.000Z',
    };

    it('logs: keeps the alert-consequence copy', () => {
      render(IngestionSkewBanner, { props: { skew, signal: 'logs' } });

      expect(screen.getByText('Logs are arriving with an out-of-range timestamp')).toBeInTheDocument();
      expect(screen.getByText(/cannot trigger an alert/)).toBeInTheDocument();
      expect(screen.getByText(/Omitting the field entirely/)).toBeInTheDocument();
    });

    it('spans: talks about trace views, not alerts or an omittable field', () => {
      const { container } = render(IngestionSkewBanner, { props: { skew, signal: 'spans' } });

      expect(screen.getByText('Spans are arriving with an out-of-range timestamp')).toBeInTheDocument();
      expect(screen.getByText(/will not appear in trace views/)).toBeInTheDocument();
      expect(screen.getByText(/clock or exporter timestamp problem/)).toBeInTheDocument();
      expect(container.textContent).not.toMatch(/cannot trigger an alert/);
      expect(container.textContent).not.toMatch(/Omitting the field entirely/);
    });

    it('metrics: talks about dashboards, not alerts or an omittable field', () => {
      const { container } = render(IngestionSkewBanner, { props: { skew, signal: 'metrics' } });

      expect(screen.getByText('Metrics are arriving with an out-of-range timestamp')).toBeInTheDocument();
      expect(screen.getByText(/will not appear in dashboards/)).toBeInTheDocument();
      expect(screen.getByText(/clock or exporter timestamp problem/)).toBeInTheDocument();
      expect(container.textContent).not.toMatch(/cannot trigger an alert/);
      expect(container.textContent).not.toMatch(/Omitting the field entirely/);
    });

    it('uses the singular noun when count24h is 1', () => {
      render(IngestionSkewBanner, {
        props: { skew: { ...skew, count24h: 1 }, signal: 'spans' },
      });

      expect(screen.getByText(/1\s+span ended with a timestamp/)).toBeInTheDocument();
    });
  });
});
