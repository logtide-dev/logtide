import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import UptimeWindows from './UptimeWindows.svelte';

describe('UptimeWindows', () => {
  it('shows a dash for null and 99.95% with two decimals', () => {
    render(UptimeWindows, {
      props: {
        windows: {
          '24h': { uptimePct: null, totalChecks: 0 },
          '7d': { uptimePct: 99.95, totalChecks: 10080 },
          '30d': { uptimePct: 100, totalChecks: 43200 },
          '90d': { uptimePct: null, totalChecks: 0 },
        },
      },
    });
    expect(screen.getByTestId('uptime-value-24h').textContent?.trim()).toBe('-');
    expect(screen.getByTestId('uptime-value-7d').textContent?.trim()).toBe('99.95%');
    expect(screen.getByTestId('uptime-value-30d').textContent?.trim()).toBe('100.00%');
    expect(screen.getByTestId('uptime-value-90d').textContent?.trim()).toBe('-');
    expect(screen.getByText('10,080 checks')).toBeInTheDocument();
    expect(screen.getAllByText('No data yet')).toHaveLength(2);
  });
});
