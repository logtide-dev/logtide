import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const gotoMock = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (...a: unknown[]) => gotoMock(...a) }));

const { getStats, getActivityOverview, getTopServices, getRecentErrors, getIngestionHealth } = vi.hoisted(() => ({
  getStats: vi.fn(),
  getActivityOverview: vi.fn(),
  getTopServices: vi.fn(),
  getRecentErrors: vi.fn(),
  getIngestionHealth: vi.fn(),
}));

vi.mock('$lib/api/dashboard', () => ({
  dashboardAPI: {
    getStats: (...a: unknown[]) => getStats(...a),
    getActivityOverview: (...a: unknown[]) => getActivityOverview(...a),
    getTopServices: (...a: unknown[]) => getTopServices(...a),
    getRecentErrors: (...a: unknown[]) => getRecentErrors(...a),
  },
}));
vi.mock('$lib/api/projects', () => ({
  projectsAPI: { getIngestionHealth: (...a: unknown[]) => getIngestionHealth(...a) },
}));

import OverviewPage, { buildOverviewLink } from './+page.svelte';
import { organizationStore } from '$lib/stores/organization';
import { page } from '$app/state';

const org = { id: 'org-1', name: 'Acme', slug: 'acme', role: 'owner' } as unknown as Parameters<
  typeof organizationStore.setCurrentOrganization
>[0];

const stats = (overrides: Record<string, unknown> = {}) => ({
  totalLogsToday: { value: 1500, trend: 5 },
  errorRate: { value: 2.5, trend: -1 },
  activeServices: { value: 3, trend: 0 },
  avgThroughput: { value: 4.2, trend: 1 },
  ...overrides,
});

const calls = () => gotoMock.mock.calls.map((c) => String(c[0]));
const paramsOf = (href: string) => new URL(href, 'http://x').searchParams;

beforeEach(() => {
  gotoMock.mockReset();
  getStats.mockReset().mockResolvedValue(stats());
  getActivityOverview.mockReset().mockResolvedValue({ series: [] });
  getTopServices.mockReset().mockResolvedValue([
    { name: 'api', count: 100, percentage: 60 },
    { name: 'billing worker', count: 50, percentage: 30 },
  ]);
  getRecentErrors.mockReset().mockResolvedValue([
    {
      time: '2026-10-21T10:00:00.000Z',
      service: 'checkout',
      level: 'error',
      message: 'Database connection refused while saving order',
      projectId: 'p-1',
      traceId: 'abc123',
    },
  ]);
  getIngestionHealth.mockReset().mockResolvedValue({ skew: { logs: null, spans: null, metrics: null } });
  (page as unknown as { params: { id: string } }).params = { id: 'p-1' };
  organizationStore.setCurrentOrganization(org);
});

afterEach(() => organizationStore.setCurrentOrganization(null));

describe('buildOverviewLink', () => {
  it('uses canonical project and range params', () => {
    expect(buildOverviewLink('/dashboard/logs', 'p-1')).toBe('/dashboard/logs?project=p-1&range=24h');
  });

  it('uses from and to for an explicit window and keeps extras', () => {
    const href = buildOverviewLink('/dashboard/logs', 'p-1', { q: 'trace:abc' }, {
      from: new Date('2026-10-21T09:00:00.000Z'),
      to: new Date('2026-10-21T10:00:00.000Z'),
    });
    const p = paramsOf(href);
    expect(p.get('project')).toBe('p-1');
    expect(p.get('from')).toBe('2026-10-21T09:00:00.000Z');
    expect(p.get('to')).toBe('2026-10-21T10:00:00.000Z');
    expect(p.get('range')).toBeNull();
    expect(p.get('q')).toBe('trace:abc');
  });
});

describe('project overview page', () => {
  it('title and heading say Overview', async () => {
    render(OverviewPage);
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(document.title.startsWith('Overview')).toBe(true);
  });

  it('uses sentence case stat card titles', async () => {
    render(OverviewPage);
    for (const t of ['Total logs today', 'Error rate', 'Active services', 'Throughput']) {
      expect(await screen.findByText(t)).toBeInTheDocument();
    }
    expect(screen.getByText('Activity overview (last 24 hours)')).toBeInTheDocument();
  });

  it('shows a skeleton while loading', () => {
    getStats.mockReturnValue(new Promise(() => {}));
    render(OverviewPage);
    expect(screen.getByTestId('overview-skeleton')).toBeInTheDocument();
  });

  it('Total logs opens the project logs for 24h', async () => {
    render(OverviewPage);
    await fireEvent.click(await screen.findByText('Total logs today'));
    const href = calls()[0];
    expect(href.startsWith('/dashboard/logs?')).toBe(true);
    const p = paramsOf(href);
    expect(p.get('project')).toBe('p-1');
    expect(p.get('range')).toBe('24h');
  });

  it('Error rate filters on error and critical through q', async () => {
    render(OverviewPage);
    await fireEvent.click(await screen.findByText('Error rate'));
    const p = paramsOf(calls()[0]);
    expect(p.get('q')).toBe('level:(error OR critical)');
    expect(p.get('project')).toBe('p-1');
    expect(p.get('range')).toBe('24h');
    expect(calls()[0]).not.toContain('(error OR');
  });

  it('a service row filters by service and quotes names with spaces', async () => {
    render(OverviewPage);
    await fireEvent.click(await screen.findByText('billing worker'));
    expect(paramsOf(calls()[0]).get('q')).toBe('service:"billing worker"');
    gotoMock.mockReset();
    await fireEvent.click(screen.getByText('api'));
    expect(paramsOf(calls()[0]).get('q')).toBe('service:api');
  });

  it('recent error click opens the Errors list filtered by the project', async () => {
    render(OverviewPage);
    await fireEvent.click(await screen.findByText(/Database connection refused/));
    const href = calls()[0];
    expect(href.startsWith('/dashboard/errors?')).toBe(true);
    const p = paramsOf(href);
    expect(p.get('project')).toBe('p-1');
    expect(p.get('search')).toBe('Database connection refused while saving order');
    expect(href).not.toContain('/dashboard/logs');
  });

  it('empty project shows the setup EmptyState with a Connect link', async () => {
    getStats.mockResolvedValue(
      stats({ totalLogsToday: { value: 0, trend: 0 }, activeServices: { value: 0, trend: 0 } }),
    );
    render(OverviewPage);
    expect(await screen.findByText('No data yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect' })).toHaveAttribute(
      'href',
      '/dashboard/projects/p-1/settings#connect',
    );
  });

  it('produces no legacy search or projectId params', async () => {
    render(OverviewPage);
    await fireEvent.click(await screen.findByText('Total logs today'));
    await fireEvent.click(screen.getByText('Error rate'));
    await fireEvent.click(screen.getByText('api'));
    await fireEvent.click(screen.getByText(/Database connection refused/));
    for (const href of calls()) {
      expect(href).not.toContain('projectId=');
      expect(href.split('?')[0]).toMatch(/^\/dashboard\/(logs|errors)$/);
      expect(href).not.toMatch(/[?&]level=/);
      expect(href).not.toMatch(/[?&]service=/);
    }
  });

  it('error state offers Retry', async () => {
    getStats.mockRejectedValueOnce(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(OverviewPage);
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByText('boom')).toBeInTheDocument();
    await fireEvent.click(retry);
    await waitFor(() => expect(getStats).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Total logs today')).toBeInTheDocument();
    spy.mockRestore();
  });
});
