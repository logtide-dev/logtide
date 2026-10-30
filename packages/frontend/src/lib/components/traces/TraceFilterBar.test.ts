import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import TraceFilterBar from './TraceFilterBar.svelte';

function props(over: Record<string, unknown> = {}) {
  return {
    services: ['api', 'web'],
    service: null,
    status: null,
    minDuration: null,
    maxDuration: null,
    attr: '',
    operation: null,
    onChange: vi.fn(),
    onJumpToTrace: vi.fn(),
    ...over,
  } as any;
}

describe('TraceFilterBar', () => {
  it('an invalid attr shows the error and does not call onChange', async () => {
    const p = props();
    render(TraceFilterBar, p);
    const input = screen.getByLabelText('Attribute filter');
    await fireEvent.input(input, { target: { value: 'a.b:"oops' } });
    expect(screen.getByRole('alert').textContent).toMatch(/character \d+/);
    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.blur(input);
    expect(p.onChange).not.toHaveBeenCalled();
  });

  it('free text in attr is rejected with a hint', async () => {
    const p = props();
    render(TraceFilterBar, p);
    const input = screen.getByLabelText('Attribute filter');
    await fireEvent.input(input, { target: { value: 'timeout' } });
    expect(screen.getByRole('alert').textContent).toMatch(/key:value/);
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onChange).not.toHaveBeenCalled();
  });

  it('a valid attr commits on Enter', async () => {
    const p = props();
    render(TraceFilterBar, p);
    const input = screen.getByLabelText('Attribute filter');
    await fireEvent.input(input, { target: { value: 'http.method:GET' } });
    expect(screen.queryByRole('alert')).toBeNull();
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onChange).toHaveBeenCalledWith({ attr: 'http.method:GET' });
  });

  it('each active chip can be removed', async () => {
    const p = props({
      operation: 'GET /a',
      minDuration: 100,
      maxDuration: 500,
      attr: 'a:1 b:2',
    });
    render(TraceFilterBar, p);
    await fireEvent.click(screen.getByRole('button', { name: 'Remove operation filter' }));
    expect(p.onChange).toHaveBeenLastCalledWith({ operation: null });
    await fireEvent.click(screen.getByRole('button', { name: 'Remove duration filter' }));
    expect(p.onChange).toHaveBeenLastCalledWith({ minDuration: null, maxDuration: null });
    await fireEvent.click(screen.getByRole('button', { name: 'Remove attribute filter a:1' }));
    expect(p.onChange).toHaveBeenLastCalledWith({ attr: 'b:2' });
  });

  it('Clear all resets every filter', async () => {
    const p = props({ service: 'api', status: 'errors', operation: 'x', attr: 'a:1' });
    render(TraceFilterBar, p);
    await fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(p.onChange).toHaveBeenCalledWith({
      service: null,
      status: null,
      minDuration: null,
      maxDuration: null,
      attr: '',
      operation: null,
    });
  });

  it('Go to trace calls onJumpToTrace with the trimmed id', async () => {
    const p = props();
    render(TraceFilterBar, p);
    const input = document.getElementById('trace-id-input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '  abc123  ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Go to trace' }));
    expect(p.onJumpToTrace).toHaveBeenCalledWith('abc123');
  });

  it('changing the service select reports the service', async () => {
    const p = props();
    render(TraceFilterBar, p);
    await fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'web' } });
    expect(p.onChange).toHaveBeenCalledWith({ service: 'web' });
  });
});
