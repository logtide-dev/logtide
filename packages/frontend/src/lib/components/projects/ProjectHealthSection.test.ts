import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const m = vi.hoisted(() => ({
  setMute: vi.fn(),
  preview: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('$lib/api/project-health', () => ({ projectHealthAPI: { setMute: m.setMute } }));
vi.mock('$lib/api/notification-routing', () => ({ notificationRoutingAPI: { preview: m.preview } }));
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: m.toastSuccess, error: m.toastError, info: vi.fn(), warning: vi.fn() },
}));

import ProjectHealthSection from './ProjectHealthSection.svelte';
import type { ProjectHealth } from '$lib/api/project-health';

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

const openSkew = {
  id: 'i1',
  checkKey: 'timestamp_skew_logs' as const,
  severity: 'warning' as const,
  openedAt: iso(3_600_000),
  lastSeenAt: iso(60_000),
  resolvedAt: null,
  details: { count24h: 900, maxPastHours: 2 },
  mute: null,
};
const resolvedPii = {
  id: 'i2',
  checkKey: 'pii_rejected' as const,
  severity: 'critical' as const,
  openedAt: iso(86_400_000),
  lastSeenAt: iso(80_000_000),
  resolvedAt: iso(79_000_000),
  details: { count60m: 2 },
  mute: null,
};

function health(overrides: Partial<ProjectHealth> = {}): ProjectHealth {
  return {
    status: 'warning',
    lastEventAt: iso(1000),
    issues: [openSkew],
    checks: { receiving: true, piiRejected24h: 0, skew: {} as never, revokedKey24h: 0 },
    settings: { silentMinutes: 60, healthChannelIds: [] },
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.preview.mockResolvedValue({ destinations: [{ id: 'c1', name: 'Ops Slack', type: 'slack' }], fallback: null });
  m.setMute.mockResolvedValue(undefined);
});

describe('ProjectHealthSection', () => {
  it('shows an open issue with explanation and action link', () => {
    render(ProjectHealthSection, { projectId: 'p1', organizationId: 'o1', health: health(), canManage: true });
    const row = screen.getByTestId('health-issue');
    expect(row).toHaveTextContent('Logs with out-of-range timestamp');
    expect(row).toHaveTextContent('900 logs');
    expect(screen.getByRole('link', { name: 'View logs' })).toHaveAttribute('href', '/dashboard/logs?project=p1');
    expect(screen.queryByTestId('health-all-clear')).toBeNull();
  });

  it('offers the mute menu to admins and sends the chosen duration', async () => {
    const onChanged = vi.fn();
    render(ProjectHealthSection, { projectId: 'p1', organizationId: 'o1', health: health(), canManage: true, onChanged });
    const trigger = screen.getByRole('button', { name: /^Mute / });
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(await screen.findByRole('menuitem', { name: '24 hours' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '7 days' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Until resolved' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Unmute' })).toBeNull();
    await fireEvent.click(screen.getByRole('menuitem', { name: '7 days' }));
    await waitFor(() => expect(m.setMute).toHaveBeenCalledWith('p1', 'timestamp_skew_logs', '7d'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('offers Unmute for a muted issue and shows the muted badge', async () => {
    const muted = { ...openSkew, mute: { until: null, untilResolved: true } };
    render(ProjectHealthSection, { projectId: 'p1', organizationId: 'o1', health: health({ issues: [muted] }), canManage: true });
    expect(screen.getByTestId('muted-badge')).toHaveTextContent('Muted until resolved');
    await fireEvent.keyDown(screen.getByRole('button', { name: /^Mute / }), { key: 'Enter' });
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Unmute' }));
    await waitFor(() => expect(m.setMute).toHaveBeenCalledWith('p1', 'timestamp_skew_logs', null));
  });

  it('hides the mute control from members', () => {
    render(ProjectHealthSection, { projectId: 'p1', organizationId: 'o1', health: health(), canManage: false });
    expect(screen.queryByRole('button', { name: /^Mute / })).toBeNull();
    expect(screen.getByRole('link', { name: 'View logs' })).toBeInTheDocument();
  });

  it('lists resolved issues after open ones in muted style without actions', () => {
    render(ProjectHealthSection, { projectId: 'p1', organizationId: 'o1', health: health({ issues: [resolvedPii, openSkew] }), canManage: true });
    const rows = screen.getAllByTestId('health-issue');
    expect(rows[0]).toHaveAttribute('data-resolved', 'false');
    expect(rows[1]).toHaveAttribute('data-resolved', 'true');
    expect(rows[1]).toHaveClass('opacity-60');
    expect(rows[1]).toHaveTextContent('Resolved');
    expect(rows[1].querySelector('a')).toBeNull();
  });

  it('shows the all passing state and a green checklist with no issues', () => {
    render(ProjectHealthSection, { projectId: 'p1', organizationId: 'o1', health: health({ status: 'healthy', issues: [] }), canManage: true });
    expect(screen.getByTestId('health-all-clear')).toHaveTextContent('All checks passing');
    const rows = Array.from(screen.getByTestId('health-checks').querySelectorAll('li'));
    expect(rows.map((r) => r.textContent?.trim())).toEqual([
      'Receiving data',
      'PII masking: 0 rejected in 24h',
      'Timestamps OK',
      'API keys OK',
    ]);
    expect(rows.every((r) => r.getAttribute('data-state') === 'ok')).toBe(true);
  });

  it('shows No data yet instead of all passing when nothing was received', () => {
    render(ProjectHealthSection, { projectId: 'p1', organizationId: 'o1', health: health({ status: 'no_data', lastEventAt: null, issues: [] }), canManage: true });
    expect(screen.getByTestId('health-all-clear')).toHaveTextContent('No data yet');
  });

  it('marks failing checks in the checklist', () => {
    render(ProjectHealthSection, { projectId: 'p1', organizationId: 'o1', health: health(), canManage: true });
    expect(screen.getByTestId('health-checks')).toHaveTextContent('Timestamps out of range: logs');
  });

  it('names the notification destinations in the footer', async () => {
    render(ProjectHealthSection, { projectId: 'p1', organizationId: 'o1', health: health(), canManage: true });
    await waitFor(() => expect(screen.getByTestId('health-notify-footer')).toHaveTextContent('Ops Slack (slack)'));
    expect(screen.getByRole('link', { name: 'Change' })).toHaveAttribute('href', '/dashboard/projects/p1/settings#notifications');
    expect(m.preview).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'project_health', projectId: 'p1' }));
  });
});
