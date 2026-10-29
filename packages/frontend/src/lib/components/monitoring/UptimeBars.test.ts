import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import UptimeBars from './UptimeBars.svelte';
import { buildDaySlots } from './uptime-bars';

describe('UptimeBars', () => {
  it('renders one cell per slot with the UTC day in the tooltip and a "No data" cell for null', () => {
    const slots = buildDaySlots(
      [{ bucket: '2026-10-22T00:00:00Z', uptimePct: 99.5, totalChecks: 100 }],
      3,
      new Date('2026-10-22T12:00:00Z')
    );
    render(UptimeBars, { props: { slots } });
    const cells = screen.getAllByTestId('uptime-cell');
    expect(cells).toHaveLength(3);
    expect(cells[0].getAttribute('title')).toBe('Oct 20 (UTC): No data');
    expect(cells[1].getAttribute('title')).toBe('Oct 21 (UTC): No data');
    expect(cells[2].getAttribute('title')).toBe('Oct 22 (UTC): 99.5% (100 checks)');
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', expect.stringContaining('3 days'));
  });
});
