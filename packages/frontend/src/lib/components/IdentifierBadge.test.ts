import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import IdentifierBadge from './IdentifierBadge.svelte';

describe('IdentifierBadge', () => {
  it('renders formatted type and value', () => {
    const { getByText } = render(IdentifierBadge, { props: { type: 'trace_id', value: 'abc123' } });
    expect(getByText('Trace ID:')).toBeTruthy();
    expect(getByText('abc123')).toBeTruthy();
  });

  it('writes the type in sentence case with ID and UUID in capitals', () => {
    const first = render(IdentifierBadge, { props: { type: 'request_id', value: 'req-1' } });
    expect(first.getByText('Request ID:')).toBeTruthy();
    first.unmount();
    const second = render(IdentifierBadge, { props: { type: 'uuid', value: 'u-1' } });
    expect(second.getByText('UUID:')).toBeTruthy();
    second.unmount();
    const third = render(IdentifierBadge, { props: { type: 'some_other_type', value: 'v' } });
    expect(third.getByText('Some other type:')).toBeTruthy();
  });

  it('names the action with the full value', () => {
    const longVal = 'a'.repeat(30);
    render(IdentifierBadge, { props: { type: 'trace_id', value: longVal } });
    expect(screen.getByRole('button', { name: `Show events with Trace ID ${longVal}` })).toBeTruthy();
  });

  it('labels the button for assistive technology', () => {
    render(IdentifierBadge, { props: { type: 'trace_id', value: 'abc123' } });
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Show events with Trace ID abc123');
  });

  it('truncates long values to 24 chars with ellipsis', () => {
    const longVal = 'a'.repeat(30);
    const { container } = render(IdentifierBadge, { props: { type: 'trace_id', value: longVal } });
    expect(container.textContent).toContain('...');
    // truncated portion should be 24 chars including the '...'
    expect(container.querySelector('span:last-child')?.textContent).toBe('a'.repeat(21) + '...');
  });

  it('does not truncate values within 24 chars', () => {
    const val = 'short-value';
    const { getByText } = render(IdentifierBadge, { props: { type: 'trace_id', value: val } });
    expect(getByText(val)).toBeTruthy();
  });

  it('calls onclick handler when clicked', () => {
    const handler = vi.fn();
    const { container } = render(IdentifierBadge, { props: { type: 'trace_id', value: 'abc', onclick: handler } });
    const btn = container.querySelector('button');
    expect(btn).not.toBeNull();
    fireEvent.click(btn!);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('applies fallback color class for unknown type', () => {
    const { container } = render(IdentifierBadge, { props: { type: 'some_other_type', value: 'val' } });
    expect(container.querySelector('button')?.className).toContain('zinc');
  });
});
