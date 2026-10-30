import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { fireEvent } from '@testing-library/svelte';
import EmptyStateSiem from './EmptyStateSiem.svelte';

describe('EmptyStateSiem', () => {
  it('shows default title for incidents type', () => {
    const { getByText } = render(EmptyStateSiem, { props: { type: 'incidents' } });
    expect(getByText('No incidents found')).toBeTruthy();
  });

  it('shows default title for detections type', () => {
    const { getByText } = render(EmptyStateSiem, { props: { type: 'detections' } });
    expect(getByText('No detection events')).toBeTruthy();
  });

  it('shows default title for comments type', () => {
    const { getByText } = render(EmptyStateSiem, { props: { type: 'comments' } });
    expect(getByText('No comments yet')).toBeTruthy();
  });

  it('shows default title for history type', () => {
    const { getByText } = render(EmptyStateSiem, { props: { type: 'history' } });
    expect(getByText('No history')).toBeTruthy();
  });

  it('renders through the shared empty state with sentence case copy', () => {
    const { getByRole, getByText } = render(EmptyStateSiem, { props: { type: 'detections' } });
    expect(getByRole('status')).toBeTruthy();
    expect(getByText('No detection events')).toBeTruthy();
    expect(getByText(/detection rules/)).toBeTruthy();
  });

  it('overrides title and description via props', () => {
    const { getByText } = render(EmptyStateSiem, {
      props: { type: 'incidents', title: 'Custom Title', description: 'Custom desc' },
    });
    expect(getByText('Custom Title')).toBeTruthy();
    expect(getByText('Custom desc')).toBeTruthy();
  });

  it('shows action button when actionLabel and onAction are provided', () => {
    const handler = vi.fn();
    const { getByText } = render(EmptyStateSiem, {
      props: { type: 'incidents', actionLabel: 'Do it', onAction: handler },
    });
    const btn = getByText('Do it');
    fireEvent.click(btn);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not render action button when only actionLabel is provided without onAction', () => {
    const { queryByText } = render(EmptyStateSiem, {
      props: { type: 'incidents', actionLabel: 'Orphan button' },
    });
    expect(queryByText('Orphan button')).toBeNull();
  });
});
