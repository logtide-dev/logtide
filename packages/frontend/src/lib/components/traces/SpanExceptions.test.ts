import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import SpanExceptions from './SpanExceptions.svelte';

describe('SpanExceptions', () => {
  it('renders the stack trace as text and does not interpret HTML', () => {
    const stack = 'Error: boom\n  at <img src=x onerror=x> handler';
    const { container } = render(SpanExceptions, {
      exceptions: [
        { time: '2026-10-22T10:00:00.000Z', type: 'TypeError', message: '<b>bad</b>', stacktrace: stack },
      ],
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toBe(stack);
    expect(screen.getByText('<b>bad</b>')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy stack trace' })).toBeInTheDocument();
  });

  it('shows a placeholder without a stack trace', () => {
    render(SpanExceptions, {
      exceptions: [{ time: '', type: 'Error', message: null, stacktrace: null }],
    });
    expect(screen.getByText('No stack trace recorded')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy stack trace' })).toBeNull();
  });
});
