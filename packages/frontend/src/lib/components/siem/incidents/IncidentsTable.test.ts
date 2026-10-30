import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Harness from './IncidentsTable.harness.svelte';

const base = {
  organizationId: 'o1',
  title: 'Disk full',
  severity: 'high',
  status: 'open',
  source: 'alert',
  projectId: 'p1',
  assigneeId: null,
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-01T10:00:00.000Z',
  lastEventAt: '2026-01-01T10:30:00.000Z',
};
const inc = (id: string, extra: Record<string, unknown> = {}) => ({ ...base, id, ...extra });
const members = [{ id: 'm1', user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' } }];

describe('IncidentsTable', () => {
  it('renders a title link to /dashboard/incidents/<id>', () => {
    render(Harness, { props: { incidents: [inc('abc')] } });
    const link = screen.getByRole('link', { name: 'Disk full' });
    expect(link.getAttribute('href')).toBe('/dashboard/incidents/abc');
  });

  it('shows Unknown user for an assignee outside members', () => {
    render(Harness, { props: { incidents: [inc('a', { assigneeId: 'gone' })], members } });
    expect(screen.getByText('Unknown user')).toBeTruthy();
  });

  it('shows the member name for a known assignee and Unassigned otherwise', () => {
    render(Harness, {
      props: { incidents: [inc('a', { assigneeId: 'u1' }), inc('b')], members },
    });
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('Unassigned')).toBeTruthy();
  });

  it('shows All projects for a null projectId and the project name otherwise', () => {
    render(Harness, { props: { incidents: [inc('a', { projectId: null }), inc('b')] } });
    expect(screen.getByText('All projects')).toBeTruthy();
    expect(screen.getByText('Project One')).toBeTruthy();
  });

  it('renders unknown source with neutral badge', () => {
    render(Harness, { props: { incidents: [inc('a', { source: 'future' })] } });
    expect(screen.getByText('future').className).toContain('bg-secondary');
  });

  it('shows Acknowledged for investigating', () => {
    render(Harness, { props: { incidents: [inc('a', { status: 'investigating' })] } });
    expect(screen.getByText('Acknowledged')).toBeTruthy();
  });

  it('selecting a row updates bound selection', async () => {
    render(Harness, { props: { incidents: [inc('a'), inc('b')] } });
    const boxes = screen.getAllByRole('checkbox', { name: 'Select row' });
    await fireEvent.click(boxes[1]);
    expect(screen.getByTestId('selected').textContent).toBe('["b"]');
  });

  it('empty rows render the empty slot', () => {
    render(Harness, { props: { incidents: [], withEmpty: true } });
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });
});
