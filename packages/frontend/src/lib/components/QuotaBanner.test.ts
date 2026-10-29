import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => ({ getCapabilityUsage: vi.fn() }));
vi.mock('$lib/api/usage', () => ({ getCapabilityUsage: h.getCapabilityUsage }));

import QuotaBanner from './QuotaBanner.svelte';

const cap = (over: Record<string, unknown>) => ({
  capability: 'ingestion.max_events_monthly',
  kind: 'quota',
  current: 10,
  limit: 5,
  description: '',
  state: 'ok',
  ...over,
});

describe('QuotaBanner', () => {
  beforeEach(() => {
    h.getCapabilityUsage.mockReset();
    sessionStorage.clear();
  });

  it('member renders nothing and does not fetch', async () => {
    h.getCapabilityUsage.mockResolvedValue({ capabilities: [cap({ state: 'blocked' })] });
    render(QuotaBanner, { organizationId: 'o1', role: 'member' });
    await Promise.resolve();
    expect(screen.queryByTestId('quota-banner')).toBeNull();
    expect(h.getCapabilityUsage).not.toHaveBeenCalled();
  });

  it('admin with ok quotas renders nothing', async () => {
    h.getCapabilityUsage.mockResolvedValue({ capabilities: [cap({})] });
    render(QuotaBanner, { organizationId: 'o1', role: 'admin' });
    await waitFor(() => expect(h.getCapabilityUsage).toHaveBeenCalledWith('o1'));
    expect(screen.queryByTestId('quota-banner')).toBeNull();
  });

  it('admin with grace shows grace text and a View usage link', async () => {
    h.getCapabilityUsage.mockResolvedValue({ capabilities: [cap({ state: 'grace' })] });
    render(QuotaBanner, { organizationId: 'o1', role: 'admin' });
    const banner = await screen.findByTestId('quota-banner');
    expect(banner.textContent).toContain(
      'Your organization is over its events limit and is using its grace allowance.'
    );
    expect(screen.getByRole('link', { name: 'View usage' })).toHaveAttribute(
      'href',
      '/dashboard/settings/usage'
    );
  });

  it('blocked wins over grace', async () => {
    h.getCapabilityUsage.mockResolvedValue({
      capabilities: [
        cap({ state: 'grace' }),
        cap({ capability: 'tracing.max_spans_monthly', state: 'blocked' }),
      ],
    });
    render(QuotaBanner, { organizationId: 'o1', role: 'owner' });
    const banner = await screen.findByTestId('quota-banner');
    expect(banner.textContent).toContain(
      'New spans data is being rejected because the limit was reached.'
    );
    expect(banner.textContent).not.toContain('grace');
  });

  it('fetch rejection renders nothing and does not throw', async () => {
    h.getCapabilityUsage.mockRejectedValue(new Error('boom'));
    render(QuotaBanner, { organizationId: 'o1', role: 'admin' });
    await waitFor(() => expect(h.getCapabilityUsage).toHaveBeenCalled());
    expect(screen.queryByTestId('quota-banner')).toBeNull();
  });

  it('dismiss hides it and survives a rerender', async () => {
    h.getCapabilityUsage.mockResolvedValue({ capabilities: [cap({ state: 'grace' })] });
    const { unmount } = render(QuotaBanner, { organizationId: 'o1', role: 'admin' });
    await fireEvent.click(await screen.findByRole('button', { name: 'Dismiss usage banner' }));
    expect(screen.queryByTestId('quota-banner')).toBeNull();
    expect(sessionStorage.getItem('quota-banner:o1:grace')).toBe('1');
    unmount();

    // a fresh mount still stays dismissed for the same state
    render(QuotaBanner, { organizationId: 'o1', role: 'admin' });
    await waitFor(() => expect(h.getCapabilityUsage).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('quota-banner')).toBeNull();
  });

  it('blocked after a dismissed grace shows again', async () => {
    sessionStorage.setItem('quota-banner:o1:grace', '1');
    h.getCapabilityUsage.mockResolvedValue({ capabilities: [cap({ state: 'blocked' })] });
    render(QuotaBanner, { organizationId: 'o1', role: 'admin' });
    expect(await screen.findByTestId('quota-banner')).toBeInTheDocument();
  });

  it('sessionStorage throwing does not break rendering', async () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      h.getCapabilityUsage.mockResolvedValue({ capabilities: [cap({ state: 'grace' })] });
      render(QuotaBanner, { organizationId: 'o1', role: 'admin' });
      await fireEvent.click(await screen.findByRole('button', { name: 'Dismiss usage banner' }));
      expect(screen.queryByTestId('quota-banner')).toBeNull();
    } finally {
      getSpy.mockRestore();
      setSpy.mockRestore();
    }
  });

  it('refetches when the organization changes', async () => {
    h.getCapabilityUsage.mockResolvedValue({ capabilities: [] });
    const { rerender } = render(QuotaBanner, { organizationId: 'o1', role: 'admin' });
    await waitFor(() => expect(h.getCapabilityUsage).toHaveBeenCalledWith('o1'));
    await rerender({ organizationId: 'o2', role: 'admin' });
    await waitFor(() => expect(h.getCapabilityUsage).toHaveBeenCalledWith('o2'));
  });
});
