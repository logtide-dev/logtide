import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import IncidentSourcePanel from './IncidentSourcePanel.svelte';

const members = [{ id: 'm1', user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' } }] as never;

function incident(over: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    title: 't',
    status: 'open',
    source: 'sigma',
    severity: 'high',
    projectId: 'p1',
    project: { id: 'p1', name: 'Web' },
    assigneeId: 'u1',
    traceId: null,
    mitreTactics: ['TA0001'],
    mitreTechniques: ['T1110'],
    affectedServices: ['auth-api'],
    ipReputation: null,
    geoData: null,
    monitorId: null,
    alertRuleId: null,
    sourceRef: null,
    createdAt: '2026-10-22T10:00:00.000Z',
    lastEventAt: '2026-10-22T10:20:00.000Z',
    resolvedAt: null,
    ...over,
  } as never;
}

const rule = {
  id: 'r1',
  name: 'Too many 500s',
  projectId: 'p1',
  service: 'api',
  level: ['error', 'critical'],
  threshold: 10,
  timeWindow: 5,
  alertType: 'threshold',
  baselineType: null,
  deviationMultiplier: null,
  query: 'timeout',
  metadataFilters: [],
} as never;

describe('IncidentSourcePanel', () => {
  it('sigma shows MITRE and affected services', () => {
    render(IncidentSourcePanel, { props: { incident: incident(), members, onAssign: vi.fn() } });
    expect(screen.getByText('Affected services')).toBeTruthy();
    expect(screen.getByText('auth-api')).toBeTruthy();
    expect(screen.getByText(/MITRE ATT/)).toBeTruthy();
  });

  it('alert shows rule summary and Show matched logs link with query, levels and window', () => {
    render(IncidentSourcePanel, {
      props: { incident: incident({ source: 'alert', alertRuleId: 'r1' }), members, rule, onAssign: vi.fn() },
    });
    expect(screen.getByText('Too many 500s')).toBeTruthy();
    expect(screen.getByText('10 logs in 5 minutes')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Show matched logs' }) as HTMLAnchorElement;
    const params = new URL(link.getAttribute('href') as string, 'http://x').searchParams;
    expect(params.get('project')).toBe('p1');
    const q = params.get('q') as string;
    expect(q).toContain('timeout');
    expect(q).toContain('level:(error OR critical)');
    expect(q).toContain('service:api');
    expect(params.get('to')).toBe('2026-10-22T10:20:00.000Z');
    // the incident spans 20 minutes, longer than the 5 minute rule window
    expect(params.get('from')).toBe('2026-10-22T10:00:00.000Z');
    expect((screen.getByRole('link', { name: 'Open rule' }) as HTMLAnchorElement).getAttribute('href')).toBe(
      '/dashboard/alerts?edit=r1'
    );
  });

  it('alert with missing rule shows the fallback', () => {
    render(IncidentSourcePanel, {
      props: { incident: incident({ source: 'alert' }), members, rule: null, onAssign: vi.fn() },
    });
    expect(screen.getByText(/Rule no longer exists/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Show matched logs' })).toBeNull();
  });

  it('monitor shows View monitor link to /dashboard/uptime/<monitorId>', () => {
    render(IncidentSourcePanel, {
      props: { incident: incident({ source: 'monitor', monitorId: 'm9' }), members, onAssign: vi.fn() },
    });
    expect((screen.getByRole('link', { name: 'View monitor' }) as HTMLAnchorElement).getAttribute('href')).toBe(
      '/dashboard/uptime/m9'
    );
  });

  it('shows All projects when the incident has no project', () => {
    render(IncidentSourcePanel, {
      props: { incident: incident({ project: null, projectId: null }), members, onAssign: vi.fn() },
    });
    expect(screen.getByText('All projects')).toBeTruthy();
  });

  it('unassign emits null', async () => {
    const onAssign = vi.fn();
    render(IncidentSourcePanel, { props: { incident: incident(), members, onAssign } });
    await fireEvent.keyDown(screen.getByRole('button', { name: /Assignee:/ }), { key: 'Enter' });
    await waitFor(() => expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Unassigned' }));
    expect(onAssign).toHaveBeenCalledWith(null);
  });
});
