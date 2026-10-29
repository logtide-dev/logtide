import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  getProjects: vi.fn(),
  getSummary: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/api/projects', () => ({
  ProjectsAPI: class {
    getProjects = h.getProjects;
  },
}));
vi.mock('$lib/api/web-vitals', () => ({
  webVitalsAPI: { getSummary: h.getSummary },
}));
vi.mock('$lib/stores/organization', async () => {
  const { writable } = await import('svelte/store');
  return { currentOrganization: writable({ id: 'org1', name: 'Org' }) };
});

import { page } from '$app/state';
import { scopeStore } from '$lib/stores/scope';
import WebVitalsPage from './+page.svelte';

const NAMES = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'] as const;

function summary(extra: Record<string, unknown> = {}) {
  return {
    projectId: 'p1',
    from: '2026-01-01T00:00:00Z',
    to: '2026-01-02T00:00:00Z',
    sampleCount: 1234,
    skipped: 0,
    truncated: false,
    metrics: NAMES.map((name) => ({
      name,
      p75: name === 'FCP' ? null : name === 'CLS' ? 0.123 : 1000,
      rating: name === 'FCP' ? null : name === 'CLS' ? 'needs-improvement' : 'good',
      samples: name === 'FCP' ? 0 : 50,
      distribution: { good: 30, needsImprovement: 15, poor: 5 },
    })),
    routes: [
      {
        route: '/pricing',
        samples: 40,
        metrics: { LCP: { p75: 4500, rating: 'poor', samples: 40 }, CLS: { p75: 0.05, rating: 'good', samples: 40 } },
      },
    ],
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (page as { url: URL }).url = new URL('http://localhost/dashboard/web-vitals');
  scopeStore.set({ projectIds: ['p1'], range: { kind: 'preset', preset: '24h' } });
  h.getProjects.mockResolvedValue({ projects: [{ id: 'p1', name: 'One' }] });
  h.getSummary.mockResolvedValue(summary());
});

describe('web vitals page', () => {
  it('renders five cards with p75 and rating', async () => {
    render(WebVitalsPage);
    await waitFor(() => expect(screen.getAllByTestId('vital-card')).toHaveLength(5));
    expect(screen.getAllByTestId('vital-rating').length).toBe(4);
    expect(screen.getByText('Cumulative Layout Shift')).toBeInTheDocument();
  });

  it('shows No data for a metric with null p75', async () => {
    render(WebVitalsPage);
    expect(await screen.findByTestId('vital-no-data')).toBeInTheDocument();
  });

  it('shows based-on-N-samples and truncated and skipped notes', async () => {
    h.getSummary.mockResolvedValue(summary({ truncated: true, skipped: 7 }));
    render(WebVitalsPage);
    const line = await screen.findByTestId('sample-line');
    expect(line).toHaveTextContent('Based on 1,234 samples');
    expect(line).toHaveTextContent('(most recent 10,000)');
    expect(line).toHaveTextContent('7 invalid records ignored');
  });

  it('renders setup EmptyState when sampleCount is 0', async () => {
    h.getSummary.mockResolvedValue(summary({ sampleCount: 0 }));
    render(WebVitalsPage);
    expect(await screen.findByText('No web vitals yet')).toBeInTheDocument();
    expect(screen.queryAllByTestId('vital-card')).toHaveLength(0);
  });

  it('route table lists routes and colours cells by rating', async () => {
    render(WebVitalsPage);
    expect(await screen.findByText('/pricing')).toBeInTheDocument();
    const cells = screen.getAllByTestId('route-vital');
    const lcp = cells.find((c) => c.textContent?.includes('4.5 s'))!;
    expect(lcp.getAttribute('data-rating')).toBe('poor');
    expect(lcp.className).toContain('destructive');
    const cls = cells.find((c) => c.textContent?.includes('0.050'))!;
    expect(cls.getAttribute('data-rating')).toBe('good');
  });

  it('scope change refetches', async () => {
    render(WebVitalsPage);
    await waitFor(() => expect(h.getSummary).toHaveBeenCalledTimes(1));
    scopeStore.setRange({ kind: 'preset', preset: '1h' });
    await waitFor(() => expect(h.getSummary).toHaveBeenCalledTimes(2));
    const second = h.getSummary.mock.calls[1][0];
    expect(Date.parse(second.to) - Date.parse(second.from)).toBe(3600_000);
    expect(second.projectId).toBe('p1');
  });

  it('error state offers retry', async () => {
    h.getSummary.mockRejectedValueOnce(new Error('boom'));
    render(WebVitalsPage);
    expect(await screen.findByText('boom')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(h.getSummary).toHaveBeenCalledTimes(2));
    expect(await screen.findAllByTestId('vital-card')).toHaveLength(5);
  });
});
