import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import QuotaStateBadge from './QuotaStateBadge.svelte';

describe('QuotaStateBadge', () => {
  it('grace without a reset date', () => {
    render(QuotaStateBadge, { state: 'grace' });
    expect(screen.getByText('Over limit, grace allowance in use')).toBeTruthy();
  });
  it('grace with a reset date', () => {
    render(QuotaStateBadge, { state: 'grace', resetsAt: new Date(Date.UTC(2026, 10, 1)) });
    expect(screen.getByText('Over limit, grace until Nov 1')).toBeTruthy();
  });
  it('accepts an ISO string for resetsAt', () => {
    render(QuotaStateBadge, { state: 'grace', resetsAt: '2026-12-01T00:00:00.000Z' });
    expect(screen.getByText('Over limit, grace until Dec 1')).toBeTruthy();
  });
  it('blocked with and without a reset date', () => {
    const { unmount } = render(QuotaStateBadge, { state: 'blocked' });
    expect(screen.getByText('Blocked, over limit')).toBeTruthy();
    unmount();
    render(QuotaStateBadge, { state: 'blocked', resetsAt: new Date(Date.UTC(2026, 10, 1)) });
    expect(screen.getByText('Blocked, over limit, resets Nov 1')).toBeTruthy();
  });
  it('uses semantic tokens, no raw palette colours', () => {
    render(QuotaStateBadge, { state: 'grace' });
    const cls = screen.getByTestId('quota-state-grace').className;
    expect(cls).toContain('text-warning-text');
    expect(cls).not.toMatch(/amber-\d/);
  });
  it('renders nothing for ok, unlimited and undefined', () => {
    for (const s of ['ok', 'unlimited', undefined] as const) {
      const { container, unmount } = render(QuotaStateBadge, { state: s });
      expect(container.textContent?.trim()).toBe('');
      unmount();
    }
  });
});
