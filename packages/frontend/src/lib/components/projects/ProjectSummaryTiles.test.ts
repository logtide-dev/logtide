import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ProjectSummaryTiles, { formatLatency, formatPct } from './ProjectSummaryTiles.svelte';

const summary = {
  logs24h: 12345,
  openErrorGroups: 3,
  tracesP95Ms: 1500,
  uptime30dPct: 99.951,
  monitorCount: 2,
  openIncidents: 0,
};

describe('ProjectSummaryTiles', () => {
  it('links each tile to its scoped global page', () => {
    render(ProjectSummaryTiles, { projectId: 'p1', summary });
    expect(screen.getByTestId('summary-tile-logs')).toHaveAttribute('href', '/dashboard/logs?project=p1');
    expect(screen.getByTestId('summary-tile-errors')).toHaveAttribute('href', '/dashboard/errors?project=p1');
    expect(screen.getByTestId('summary-tile-traces')).toHaveAttribute('href', '/dashboard/traces?project=p1');
    expect(screen.getByTestId('summary-tile-uptime')).toHaveAttribute('href', '/dashboard/uptime?project=p1');
    expect(screen.getByTestId('summary-tile-incidents')).toHaveAttribute('href', '/dashboard/incidents?project=p1');
  });

  it('formats values', () => {
    render(ProjectSummaryTiles, { projectId: 'p1', summary });
    const values = screen.getAllByTestId('summary-tile-value').map((v) => v.textContent?.trim());
    expect(values).toEqual(['12,345', '3', '1.5 s', '99.95%', '0']);
  });

  it('renders a dash for every null field', () => {
    render(ProjectSummaryTiles, {
      projectId: 'p1',
      summary: { logs24h: null, openErrorGroups: null, tracesP95Ms: null, uptime30dPct: null, monitorCount: null, openIncidents: null },
    });
    expect(screen.getAllByTestId('summary-tile-value').map((v) => v.textContent?.trim())).toEqual(['-', '-', '-', '-', '-']);
  });

  it('renders dashes when the whole summary failed', () => {
    render(ProjectSummaryTiles, { projectId: 'p1', summary: null });
    expect(screen.getAllByTestId('summary-tile-value').map((v) => v.textContent?.trim())).toEqual(['-', '-', '-', '-', '-']);
  });

  it('says No monitors with a create link when there are none', () => {
    render(ProjectSummaryTiles, { projectId: 'p1', summary: { ...summary, monitorCount: 0, uptime30dPct: null } });
    const tile = screen.getByTestId('summary-tile-uptime');
    expect(tile).toHaveTextContent('No monitors');
    expect(tile).toHaveTextContent('Create one');
  });

  it('formatters', () => {
    expect(formatLatency(null)).toBe('-');
    expect(formatLatency(240.4)).toBe('240 ms');
    expect(formatPct(100)).toBe('100%');
  });
});
