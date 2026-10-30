import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { DetectionEvent } from '@logtide/shared';
import RuleMatchesTable from './RuleMatchesTable.svelte';

function match(over: Partial<DetectionEvent> = {}): DetectionEvent {
  return {
    id: 'd1',
    time: '2026-10-20T10:00:00.000Z',
    organizationId: 'org-1',
    projectId: 'proj-1',
    sigmaRuleId: 'rule-1',
    logId: 'log-1',
    severity: 'high',
    ruleTitle: 'Suspicious login',
    ruleDescription: null,
    mitreTactics: null,
    mitreTechniques: null,
    service: 'auth',
    logLevel: 'error',
    logMessage: 'Failed login for admin',
    traceId: null,
    matchedFields: null,
    incidentId: null,
    category: 'security',
    ...over,
  };
}

describe('RuleMatchesTable', () => {
  it('log link carries from and to five minutes around the match', () => {
    render(RuleMatchesTable, { matches: [match()], total: 1, loading: false, onPage: vi.fn() });
    const href = screen.getByRole('link', { name: 'View log' }).getAttribute('href') ?? '';
    const url = new URL(href, 'http://x');
    expect(url.pathname).toBe('/dashboard/logs');
    expect(url.searchParams.get('logId')).toBe('log-1');
    expect(url.searchParams.get('project')).toBe('proj-1');
    expect(url.searchParams.get('from')).toBe('2026-10-20T09:55:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-10-20T10:05:00.000Z');
  });

  it('incident link only when incidentId', () => {
    render(RuleMatchesTable, {
      matches: [match({ id: 'a', incidentId: 'inc-7' }), match({ id: 'b', incidentId: null })],
      total: 2,
      loading: false,
      onPage: vi.fn(),
    });
    const links = screen.getAllByRole('link', { name: 'Open incident' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/dashboard/incidents/inc-7');
  });

  it('empty state copy', () => {
    render(RuleMatchesTable, { matches: [], total: 0, loading: false, onPage: vi.fn() });
    expect(screen.getByText('No matches in the last 7 days')).toBeInTheDocument();
  });

  it('asks for the next page by offset', async () => {
    const onPage = vi.fn();
    render(RuleMatchesTable, {
      matches: [match()],
      total: 45,
      loading: false,
      onPage,
      pageSize: 20,
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPage).toHaveBeenCalledWith(20);
  });
});
