import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import ProjectsTable from './ProjectsTable.svelte';

const project = (id: string, name: string) =>
  ({ id, organizationId: 'o', name, description: `${name} desc`, slug: id }) as never;

const projects = [project('a', 'Alpha'), project('b', 'Beta'), project('c', 'Gamma')];

const stats = {
  a: { logs24h: 1000, errors24h: 20, hourly: [1, 2], openIncidents: 0 }, // 2% amber
  b: { logs24h: 1000, errors24h: 100, hourly: [1, 2], openIncidents: 1 }, // 10% red
  c: { logs24h: 50, errors24h: 50, hourly: [1], openIncidents: 0 }, // 100% but low volume
};

const now = Date.now();
const lastEventAt = {
  a: new Date(now - 60_000).toISOString(),
  b: new Date(now - 3_600_000).toISOString(),
  c: null,
};

function names(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('link')[0].textContent!.trim());
}

const base = { projects, stats, health: {}, lastEventAt, receiving: new Set<string>() };

describe('ProjectsTable', () => {
  it('links the name to the scoped logs URL', () => {
    render(ProjectsTable, base);
    expect(screen.getByRole('link', { name: 'Alpha' })).toHaveAttribute('href', '/dashboard/logs?project=a');
  });

  it('shows Connect only for projects with no data', () => {
    render(ProjectsTable, {
      ...base,
      health: {
        a: { status: 'healthy', openIssues: [] },
        b: { status: 'healthy', openIssues: [] },
        c: { status: 'no_data', openIssues: [] },
      },
    });
    const connect = screen.getAllByRole('link', { name: 'Connect' });
    expect(connect).toHaveLength(1);
    expect(connect[0]).toHaveAttribute('href', '/dashboard/projects/c/settings#connect');
    expect(screen.getAllByRole('link', { name: 'Project settings' })[0]).toHaveAttribute(
      'href',
      '/dashboard/projects/a',
    );
  });

  it('defaults to last event descending, missing last', () => {
    render(ProjectsTable, base);
    expect(names()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('sorts by error rate', async () => {
    render(ProjectsTable, base);
    await fireEvent.click(screen.getByRole('button', { name: /Error rate/ }));
    await fireEvent.click(screen.getByRole('button', { name: /Error rate/ })); // asc then desc
    expect(names()).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  it('colors the error rate only with enough volume', () => {
    render(ProjectsTable, base);
    const rates = screen.getAllByTestId('error-rate');
    const byText = Object.fromEntries(rates.map((r) => [r.textContent, r.className]));
    expect(byText['2.0%']).toContain('amber');
    expect(byText['10%']).toContain('red');
    expect(byText['100%']).not.toMatch(/red|amber/);
  });

  it('health filter With problems hides healthy projects', () => {
    render(ProjectsTable, {
      ...base,
      healthFilter: 'problems',
      health: {
        a: { status: 'healthy', openIssues: [] },
        b: { status: 'warning', openIssues: [{ checkKey: 'revoked_key', severity: 'warning', muted: false }] },
      },
    });
    expect(names()).toEqual(['Beta']);
  });

  it('shows dashes when stats are unavailable', () => {
    render(ProjectsTable, { ...base, stats: null });
    expect(screen.queryAllByTestId('error-rate')).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getAllByText('-').length).toBeGreaterThan(0);
  });
});
