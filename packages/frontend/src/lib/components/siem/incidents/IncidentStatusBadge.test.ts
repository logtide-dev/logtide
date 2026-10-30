import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import IncidentStatusBadge from './IncidentStatusBadge.svelte';

describe('IncidentStatusBadge', () => {
  it('renders Open label for open status', () => {
    const { getByText } = render(IncidentStatusBadge, { props: { status: 'open' } });
    expect(getByText('Open')).toBeTruthy();
  });

  it('renders Acknowledged label for investigating status', () => {
    const { getByText, queryByText } = render(IncidentStatusBadge, { props: { status: 'investigating' } });
    expect(getByText('Acknowledged')).toBeTruthy();
    expect(queryByText('Investigating')).toBeNull();
  });

  it('renders Resolved label for resolved status', () => {
    const { getByText } = render(IncidentStatusBadge, { props: { status: 'resolved' } });
    expect(getByText('Resolved')).toBeTruthy();
  });

  it('renders False positive label for false_positive status', () => {
    const { getByText } = render(IncidentStatusBadge, { props: { status: 'false_positive' } });
    expect(getByText('False positive')).toBeTruthy();
  });

  it('falls back to raw status for unknown value', () => {
    const { getByText } = render(IncidentStatusBadge, { props: { status: 'unknown_state' as 'open' } });
    expect(getByText('unknown_state')).toBeTruthy();
  });

  it('uses tone tokens with no raw palette classes', () => {
    const { container } = render(IncidentStatusBadge, { props: { status: 'investigating' } });
    expect(container.innerHTML).toContain('text-warning-text');
    expect(container.innerHTML).not.toMatch(/bg-(blue|yellow|green|gray)-\d/);
  });

  it('applies sm size class when size=sm', () => {
    const { container } = render(IncidentStatusBadge, { props: { status: 'open', size: 'sm' } });
    expect(container.innerHTML).toContain('px-1.5');
  });

  it('hides icon when showIcon=false', () => {
    const { container } = render(IncidentStatusBadge, { props: { status: 'open', showIcon: false } });
    expect(container.querySelector('svg')).toBeNull();
  });
});
