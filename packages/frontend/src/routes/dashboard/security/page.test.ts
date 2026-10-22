import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('echarts', () => ({
  init: vi.fn(() => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    off: vi.fn(),
    on: vi.fn(),
  })),
  graphic: { LinearGradient: class {} },
}));

const api = vi.hoisted(() => ({
  getDashboardStats: vi.fn(),
  getRecentDetections: vi.fn(),
  getProjects: vi.fn(),
}));

vi.mock('$lib/api/siem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/api/siem')>()),
  getDashboardStats: api.getDashboardStats,
  getRecentDetections: api.getRecentDetections,
}));
vi.mock('$lib/api/projects', () => ({ projectsAPI: { getProjects: api.getProjects } }));
vi.mock('$lib/components/DetectionPacksGalleryDialog.svelte', async () => ({
  default: (await import('$lib/components/siem/rules/test-stub.svelte')).default,
}));

import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import Page from './+page.svelte';
import { organizationStore } from '$lib/stores/organization';
import { scopeStore } from '$lib/stores/scope';
import { siemStore } from '$lib/stores/siem';
import { displayPreferences } from '$lib/stores/display-preferences';

const org = {
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  ownerId: 'u1',
  role: 'owner' as const,
  retentionDays: 90,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const projects = [
  { id: 'p1', name: 'Project one' },
  { id: 'p2', name: 'Project two' },
  { id: 'p3', name: 'Project three' },
];

const stats = {
  totalDetections: 10,
  totalIncidents: 2,
  openIncidents: 1,
  severityDistribution: [],
  timeline: [],
  affectedServices: [],
  mitreHeatmap: [],
  topThreats: [
    {
      ruleId: 'rule-1',
      ruleTitle: 'Brute force login',
      count: 7,
      severity: 'high',
      mitreTactics: null,
      mitreTechniques: null,
    },
  ],
};

const emptyStats = { ...stats, totalDetections: 0, totalIncidents: 0, topThreats: [] };

beforeEach(() => {
  class RO {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal('ResizeObserver', RO);
  localStorage.clear();
  scopeStore.reset();
  displayPreferences.set({ hour12: false, timeZone: 'UTC' });
  (page as { url: URL }).url = new URL('http://localhost/dashboard/security');
  api.getDashboardStats.mockReset().mockResolvedValue(stats);
  api.getRecentDetections.mockReset().mockResolvedValue({ detections: [] });
  api.getProjects.mockReset().mockResolvedValue({ projects });
  vi.mocked(goto).mockClear();
  vi.spyOn(siemStore, 'startRealtimeUpdates').mockResolvedValue(undefined);
  vi.spyOn(siemStore, 'stopRealtimeUpdates').mockImplementation(() => {});
  siemStore.clear();
  organizationStore.clear();
  organizationStore.setCurrentOrganization({ ...org });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('security overview page', () => {
  it('top threat click navigates to incidents with ruleId', async () => {
    render(Page);
    await fireEvent.click(await screen.findByText('Brute force login'));
    expect(goto).toHaveBeenCalledWith('/dashboard/incidents?source=sigma&ruleId=rule-1');
  });

  it('several selected projects shows the all projects note and sends no projectId', async () => {
    scopeStore.set({
      projectIds: ['p1', 'p2'],
      range: { kind: 'preset', preset: '24h' },
    });
    (page as { url: URL }).url = new URL('http://localhost/dashboard/security?project=p1,p2');
    render(Page);
    await screen.findByText('Brute force login');
    expect(screen.getByText('Showing all projects')).toBeTruthy();
    expect(api.getDashboardStats).toHaveBeenCalled();
    for (const call of api.getDashboardStats.mock.calls) {
      expect(call[0].projectId).toBeUndefined();
    }
  });

  it('a single selected project is sent as projectId', async () => {
    (page as { url: URL }).url = new URL('http://localhost/dashboard/security?project=p1');
    render(Page);
    await screen.findByText('Brute force login');
    expect(api.getDashboardStats.mock.calls.at(-1)?.[0].projectId).toBe('p1');
    expect(screen.queryByText('Showing all projects')).toBeNull();
  });

  it('empty state offers detection rules and packs', async () => {
    api.getDashboardStats.mockResolvedValue(emptyStats);
    render(Page);
    expect(await screen.findByText('No detections yet')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Open detection rules' }));
    expect(goto).toHaveBeenCalledWith('/dashboard/security/rules');
    expect(screen.getByRole('button', { name: 'Browse detection packs' })).toBeTruthy();
  });

  it('error state retry reloads', async () => {
    api.getDashboardStats.mockRejectedValueOnce(new Error('boom'));
    render(Page);
    const retry = await screen.findByRole('button', { name: 'Retry' });
    const before = api.getDashboardStats.mock.calls.length;
    await fireEvent.click(retry);
    await waitFor(() => expect(api.getDashboardStats.mock.calls.length).toBeGreaterThan(before));
    expect(await screen.findByText('Brute force login')).toBeTruthy();
  });
});
