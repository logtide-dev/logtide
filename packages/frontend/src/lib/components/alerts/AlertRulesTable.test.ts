import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/svelte';

vi.mock('$lib/api/notification-routing', () => ({
  notificationRoutingAPI: { preview: vi.fn().mockResolvedValue({ destinations: [], fallback: false }) },
}));
vi.mock('$lib/stores/organization', async () => {
  const { writable } = await import('svelte/store');
  return { organizationStore: writable({ currentOrganization: { id: 'org-1' } }) };
});

import AlertRulesTable from './AlertRulesTable.svelte';
import type { AlertHistory, AlertRule } from '$lib/api/alerts';

function rule(over: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'r1',
    organizationId: 'org-1',
    projectId: 'p1',
    name: 'High errors',
    enabled: true,
    service: null,
    level: ['error'],
    threshold: 10,
    timeWindow: 5,
    alertType: 'threshold',
    baselineType: null,
    deviationMultiplier: null,
    minBaselineValue: null,
    cooldownMinutes: null,
    sustainedMinutes: null,
    emailRecipients: [],
    webhookUrl: null,
    channelIds: ['c1'],
    metadataFilters: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}

function mount(rules: AlertRule[], extra: Record<string, unknown> = {}) {
  const handlers = {
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onSnooze: vi.fn(),
    onUnsnooze: vi.fn(),
  };
  render(AlertRulesTable, {
    props: {
      rules,
      history: [] as AlertHistory[],
      projectNames: { p1: 'Web' },
      channelNames: { c1: 'Slack: #ops', c2: 'Email: team' },
      loading: false,
      busyIds: [],
      ...handlers,
      ...extra,
    },
  });
  return handlers;
}

afterEach(() => cleanup());

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

describe('AlertRulesTable', () => {
  it('state column shows Firing, OK, Snoozed (with until time) and Disabled', () => {
    mount([
      rule({ id: 'a', name: 'A', state: 'firing' }),
      rule({ id: 'b', name: 'B', state: 'ok' }),
      rule({ id: 'c', name: 'C', snoozedUntil: hoursFromNow(2) }),
      rule({ id: 'd', name: 'D', enabled: false }),
    ]);
    const badges = screen.getAllByTestId('severity-badge').map((b) => b.textContent?.trim());
    expect(badges).toEqual(['Firing', 'OK', 'Snoozed', 'Disabled']);
    expect(screen.getByText(/^until/)).toBeTruthy();
  });

  it('snoozed and firing shows Snoozed', () => {
    mount([rule({ state: 'firing', snoozedUntil: hoursFromNow(1) })]);
    expect(screen.getByTestId('severity-badge').textContent?.trim()).toBe('Snoozed');
  });

  it('disabled and snoozed shows Disabled', () => {
    mount([rule({ enabled: false, snoozedUntil: hoursFromNow(1) })]);
    expect(screen.getByTestId('severity-badge').textContent?.trim()).toBe('Disabled');
  });

  it('last triggered renders a Timestamp and a dash when null', () => {
    mount([
      rule({ id: 'a', name: 'A', lastTriggeredAt: '2026-10-20T10:00:00Z' }),
      rule({ id: 'b', name: 'B', lastTriggeredAt: null }),
    ]);
    const rows = screen.getAllByRole('row');
    expect(rows[1].querySelector('time')).toBeTruthy();
    expect(within(rows[2]).getAllByText('-').length).toBeGreaterThan(0);
  });

  it('24 h triggers comes from countTriggers24h', () => {
    const recent = new Date(Date.now() - 3_600_000).toISOString();
    const history = [
      { ruleId: 'a', triggeredAt: recent },
      { ruleId: 'a', triggeredAt: recent },
      { ruleId: 'other', triggeredAt: recent },
    ] as AlertHistory[];
    mount([rule({ id: 'a', name: 'A' }), rule({ id: 'b', name: 'B', triggers24h: 7 })], { history });
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('2')).toBeTruthy();
    expect(within(rows[2]).getByText('7')).toBeTruthy();
  });

  it('rule with channelIds renders names without WillNotify', () => {
    mount([rule({ channelIds: ['c1', 'c2'] })]);
    expect(screen.getByTestId('notify-summary').textContent).toBe('Slack: #ops, Email: team');
    expect(screen.queryByTestId('will-notify')).toBeNull();
  });

  it('rule without channels renders WillNotify', async () => {
    mount([rule({ channelIds: [] })]);
    expect(await screen.findByTestId('will-notify')).toBeTruthy();
  });

  it('toggle emits onToggle', async () => {
    const { onToggle } = mount([rule()]);
    await fireEvent.click(screen.getByRole('switch', { name: 'Disable High errors' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle.mock.calls[0][0].id).toBe('r1');
  });

  it('org-wide rule shows All projects', () => {
    mount([rule({ projectId: null })]);
    expect(screen.getByText('All projects')).toBeTruthy();
  });

  it('rate of change rules carry the Anomaly marker', () => {
    mount([rule({ alertType: 'rate_of_change' })]);
    expect(screen.getByText('Anomaly')).toBeTruthy();
  });

  it('action buttons have accessible names and emit', async () => {
    const h = mount([rule()]);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit alert High errors' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Duplicate alert High errors' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete alert High errors' }));
    expect(h.onEdit).toHaveBeenCalledTimes(1);
    expect(h.onDuplicate).toHaveBeenCalledTimes(1);
    expect(h.onDelete).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Snooze alert' })).toBeTruthy();
  });

  it('busy rows disable their controls', () => {
    mount([rule()], { busyIds: ['r1'] });
    expect((screen.getByRole('button', { name: 'Edit alert High errors' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Pending is never used here', () => {
    mount([rule({ state: 'firing' }), rule({ id: 'b', name: 'B' })]);
    expect(screen.queryByText('Pending')).toBeNull();
  });
});
