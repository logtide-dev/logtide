import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import QuotaStateBadge from './QuotaStateBadge.svelte';

describe('QuotaStateBadge', () => {
  it('shows In grace', () => {
    render(QuotaStateBadge, { state: 'grace' });
    expect(screen.getByText('In grace')).toBeTruthy();
  });
  it('shows Blocked', () => {
    render(QuotaStateBadge, { state: 'blocked' });
    expect(screen.getByText('Blocked')).toBeTruthy();
  });
  it('renders nothing for ok, unlimited and undefined', () => {
    for (const s of ['ok', 'unlimited', undefined] as const) {
      const { container, unmount } = render(QuotaStateBadge, { state: s });
      expect(container.textContent?.trim()).toBe('');
      unmount();
    }
  });
});
