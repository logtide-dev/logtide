import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

const { getCapabilityUsage } = vi.hoisted(() => ({ getCapabilityUsage: vi.fn() }));
vi.mock('$lib/api/usage', () => ({ getCapabilityUsage: (...a: unknown[]) => getCapabilityUsage(...a) }));

import QuotaNearLimitBanner from './QuotaNearLimitBanner.svelte';

const cap = (current: number, limit: number | null, kind: 'quota' | 'limit' = 'quota') => ({
  capability: 'logs.ingested',
  kind,
  current,
  limit,
  description: 'Monthly log ingestion',
});

describe('QuotaNearLimitBanner', () => {
  beforeEach(() => {
    getCapabilityUsage.mockReset();
  });

  it('shows at 80% for owners', async () => {
    getCapabilityUsage.mockResolvedValue({ capabilities: [cap(80, 100)] });
    render(QuotaNearLimitBanner, { organizationId: 'o1', role: 'owner' });
    expect(await screen.findByText('Monthly log ingestion is at 80% of your plan limit.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View usage' })).toHaveAttribute('href', '/dashboard/settings/usage');
  });

  it('stays hidden at 79%', async () => {
    getCapabilityUsage.mockResolvedValue({ capabilities: [cap(79, 100)] });
    render(QuotaNearLimitBanner, { organizationId: 'o1', role: 'admin' });
    await waitFor(() => expect(getCapabilityUsage).toHaveBeenCalled());
    expect(screen.queryByTestId('quota-near-limit-banner')).toBeNull();
  });

  it('ignores limit kinds and unlimited quotas', async () => {
    getCapabilityUsage.mockResolvedValue({ capabilities: [cap(95, 100, 'limit'), cap(500, null)] });
    render(QuotaNearLimitBanner, { organizationId: 'o1', role: 'owner' });
    await waitFor(() => expect(getCapabilityUsage).toHaveBeenCalled());
    expect(screen.queryByTestId('quota-near-limit-banner')).toBeNull();
  });

  it('never fetches or shows for members', async () => {
    getCapabilityUsage.mockResolvedValue({ capabilities: [cap(99, 100)] });
    render(QuotaNearLimitBanner, { organizationId: 'o1', role: 'member' });
    expect(getCapabilityUsage).not.toHaveBeenCalled();
    expect(screen.queryByTestId('quota-near-limit-banner')).toBeNull();
  });

  it('stays hidden when the request fails', async () => {
    getCapabilityUsage.mockImplementation(async () => {
      throw new Error('boom');
    });
    render(QuotaNearLimitBanner, { organizationId: 'o1', role: 'owner' });
    await new Promise((r) => setTimeout(r, 10));
    expect(getCapabilityUsage.mock.calls.length).toBe(1);
    expect(screen.queryByTestId('quota-near-limit-banner')).toBeNull();
  });
});
