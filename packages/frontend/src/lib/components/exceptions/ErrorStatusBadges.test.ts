import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ErrorStatusBadges from './ErrorStatusBadges.svelte';

const regressedAt = '2026-10-21T10:00:00.000Z';

describe('ErrorStatusBadges', () => {
  it('shows Regressed only when regressedAt is set and not resolved', () => {
    const { unmount } = render(ErrorStatusBadges, { group: { status: 'open', regressedAt } });
    expect(screen.getByText('Regressed')).toBeInTheDocument();
    unmount();

    const ignored = render(ErrorStatusBadges, { group: { status: 'ignored', regressedAt } });
    expect(screen.getByText('Regressed')).toBeInTheDocument();
    ignored.unmount();

    const resolved = render(ErrorStatusBadges, { group: { status: 'resolved', regressedAt } });
    expect(screen.queryByText('Regressed')).toBeNull();
    resolved.unmount();

    render(ErrorStatusBadges, { group: { status: 'open', regressedAt: null } });
    expect(screen.queryByText('Regressed')).toBeNull();
  });

  it('labels are sentence case', () => {
    const { unmount } = render(ErrorStatusBadges, { group: { status: 'open', regressedAt } });
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Regressed')).toBeInTheDocument();
    unmount();

    const resolved = render(ErrorStatusBadges, { group: { status: 'resolved' } });
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    resolved.unmount();

    render(ErrorStatusBadges, { group: { status: 'ignored' } });
    expect(screen.getByText('Ignored')).toBeInTheDocument();
  });
});
