import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import PublicMonitorGroup from './PublicMonitorGroup.svelte';
import { groupMonitors } from './group-monitors';
import type { PublicMonitorStatus } from '$lib/api/status-page';

function monitor(name: string, groupName: string | null, extra: Partial<PublicMonitorStatus> = {}): PublicMonitorStatus {
  return { name, groupName, status: 'up', uptimeHistory: [], ...extra };
}

function dayAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

describe('groupMonitors', () => {
  it('groups ungrouped components first, then groups by first appearance', () => {
    const groups = groupMonitors([
      monitor('B1', 'Beta'),
      monitor('Loose', null),
      monitor('A1', 'Alpha'),
      monitor('B2', 'Beta'),
      monitor('Loose 2', null),
    ]);
    expect(groups.map((g) => g.name)).toEqual([null, 'Beta', 'Alpha']);
    expect(groups[0].monitors.map((m) => m.name)).toEqual(['Loose', 'Loose 2']);
    expect(groups[1].monitors.map((m) => m.name)).toEqual(['B1', 'B2']);
  });

  it('returns no groups for no monitors', () => {
    expect(groupMonitors([])).toEqual([]);
  });
});

describe('PublicMonitorGroup', () => {
  it('renders the ungrouped block without a heading and named groups with one', () => {
    render(PublicMonitorGroup, {
      props: { groups: groupMonitors([monitor('Loose', null), monitor('API', 'Core')]) },
    });
    expect(screen.getByRole('heading', { name: 'Core' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByText('Loose')).toBeInTheDocument();
  });

  it('renders the type chip only when the payload carries type', () => {
    render(PublicMonitorGroup, {
      props: { groups: groupMonitors([monitor('API', null, { type: 'http' }), monitor('DB', null)]) },
    });
    const chips = screen.getAllByTestId('type-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent?.trim()).toBe('HTTP(S)');
  });

  it('each component shows 90 day bars, a weighted 90 day uptime and axis labels that match the slots', () => {
    const history = [
      { bucket: dayAgo(1), uptimePct: 100, totalChecks: 300 },
      { bucket: dayAgo(0), uptimePct: 50, totalChecks: 100 },
    ];
    render(PublicMonitorGroup, {
      props: { groups: groupMonitors([monitor('API', null, { uptimeHistory: history })]) },
    });
    const row = screen.getByTestId('public-monitor');
    expect(within(row).getAllByTestId('uptime-cell')).toHaveLength(90);
    expect(within(row).getByText('90 days ago')).toBeInTheDocument();
    expect(within(row).getByText('Today')).toBeInTheDocument();
    expect(within(row).getByTestId('uptime-pct').textContent?.trim()).toBe('87.5%');
  });

  it('shows a dash instead of a percentage without data', () => {
    render(PublicMonitorGroup, { props: { groups: groupMonitors([monitor('API', null)]) } });
    expect(screen.getByTestId('uptime-pct').textContent?.trim()).toBe('-');
  });

  it('labels the status for assistive tech', () => {
    render(PublicMonitorGroup, {
      props: { groups: groupMonitors([monitor('API', null, { status: 'down' })]) },
    });
    expect(screen.getByLabelText('Down')).toBeInTheDocument();
  });
});
